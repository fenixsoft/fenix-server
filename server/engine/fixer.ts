/**
 * server/engine/fixer.ts
 *
 * Claude 修复编排（add-claude-fallback）。
 *
 * 职责：失败任务触发修复时
 *   1. 可用性检测（`which claude && claude --version`），缺失报明确错误、不建会话
 *   2. 构造上下文提示词（任务标题/描述 + 失败阶段 + 失败命令原文 +
 *      错误输出尾部（上限 8KB 截头留尾）+ claude_hint + 行为目标）
 *   3. PTY 启动 `claude --dangerously-skip-permissions '<prompt>'`，
 *      隧道开启时注入代理环境变量（env 前缀）保证 API 可达
 *   4. 任务状态 failed → fixing（复用 runner.fix）
 *   5. 输出转发（'claude-output' 事件，供 ws 层翻译为 claude-output 消息）
 *   6. claude 正常退出 → 自动重跑（runner.retry，复用 retry 语义）；
 *      重跑成功→队列继续，仍失败→回 failed 可再次决策
 *   7. abort（用户中止 / PTY 异常）→ 任务置回 failed，会话资源清理
 *
 * 约束：同一时刻最多一个修复会话；并发 start 被拒绝并指明当前修复中的任务。
 */
import { EventEmitter } from 'node:events';
import { TaskRunner, type FailureContext } from './runner.js';
import type { CommandExecutor } from './runner.js';
import type { TunnelManager } from '../ssh/tunnel.js';
import type { PtyOpenOptions } from '../ssh/pty.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** PTY 会话的最小接口 —— PtySession 结构性满足；测试注入 fake。 */
export interface PtySessionLike {
  readonly active: boolean;
  readonly wasAborted: boolean;
  open(command: string, options: PtyOpenOptions): Promise<void>;
  write(data: string): void;
  close(): void;
}

export interface FixerOptions {
  /** 任务执行器（含 fixing 状态机）。 */
  runner: TaskRunner;
  /** 可用性检测（`which claude`）使用的命令执行器。 */
  executor: CommandExecutor;
  /** PTY 会话工厂；缺省时需由调用方绑定连接创建真实 PtySession。 */
  ptyFactory: () => PtySessionLike;
  /** 隧道管理器（可选；提供时保证开启并注入代理环境变量）。 */
  tunnel?: TunnelManager | null;
  /** claude 可执行名（默认 'claude'）。 */
  claudeCommand?: string;
  /** 可用性检测命令（默认 'which claude && claude --version'）。 */
  claudeCheckCommand?: string;
  /** 提示词错误输出尾部上限（默认 8 * 1024）。 */
  errorTailLimit?: number;
}

export interface PromptContext {
  taskId: string;
  title: string;
  description?: string;
  /** 失败阶段描述，如 "command 2" / "verify"。 */
  failStage: string;
  /** 失败的命令原文。 */
  command: string;
  /** 错误输出尾部（构造时已截断到上限）。 */
  errorTail: string;
  /** 领域提示（claude_hint，存在时）。 */
  claudeHint?: string;
}

export const DEFAULT_ERROR_TAIL_LIMIT = 8 * 1024;

// ---------------------------------------------------------------------------
//  Prompt 构造（纯函数，独立可测）
// ---------------------------------------------------------------------------

/**
 * 构造修复提示词。错误输出尾部截头留尾（上限 limit 字节），
 * 截断时标注前部省略。任务描述缺失时显式标注，claude_hint 存在时追加。
 */
export function buildFixPrompt(ctx: PromptContext, limit = DEFAULT_ERROR_TAIL_LIMIT): string {
  const tail = truncateTail(ctx.errorTail, limit);
  const parts = [
    `任务「${ctx.title}」执行失败，请修复。`,
    '',
    `任务描述: ${ctx.description ?? '（无）'}`,
    `失败阶段: ${ctx.failStage}`,
    `失败命令: ${ctx.command}`,
    '',
    `错误输出尾部（${tail.length} 字节）:`,
    '```',
    tail,
    '```',
  ];
  if (ctx.claudeHint) {
    parts.push('', `修复提示: ${ctx.claudeHint}`);
  }
  parts.push('', '请修复使上述命令能够成功执行，不要改动其他系统配置。');
  return parts.join('\n');
}

/** 截头留尾：超过 limit 字节时仅保留最后 limit 字节，并标注省略。 */
export function truncateTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `（前部 ${text.length - limit} 字节已省略）\n${text.slice(-limit)}`;
}

/** shell 单引号转义（用于把 prompt/环境变量值安全拼入远端命令行）。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
//  Fixer
// ---------------------------------------------------------------------------

/**
 * 修复编排器。事件：
 *   'claude-output' (data: string)  — claude 的 PTY 输出分片（含 ANSI），
 *                                     供 ws 层翻译为 claude-output 消息。
 */
export class Fixer extends EventEmitter {
  private readonly runner: TaskRunner;
  private readonly executor: CommandExecutor;
  private readonly ptyFactory: () => PtySessionLike;
  private readonly tunnel?: TunnelManager | null;
  private readonly claudeCommand: string;
  private readonly claudeCheckCommand: string;
  private readonly errorTailLimit: number;

  private _activeTaskId: string | null = null;
  private _pty: PtySessionLike | null = null;
  private _aborting = false;

  constructor(options: FixerOptions) {
    super();
    this.runner = options.runner;
    this.executor = options.executor;
    this.ptyFactory = options.ptyFactory;
    this.tunnel = options.tunnel;
    this.claudeCommand = options.claudeCommand ?? 'claude';
    this.claudeCheckCommand = options.claudeCheckCommand ?? 'which claude && claude --version';
    this.errorTailLimit = options.errorTailLimit ?? DEFAULT_ERROR_TAIL_LIMIT;
  }

  /** 当前正在修复的任务 id（无会话时 null）。 */
  get activeTaskId(): string | null {
    return this._activeTaskId;
  }

  /** 是否有进行中的修复会话。 */
  get busy(): boolean {
    return this._activeTaskId !== null;
  }

  /**
   * 触发任务修复。依序执行：单会话约束 → 可修复性检查 →
   * claude 可用性检测 → 提示词构造 → 隧道代理注入 → fixing 状态 →
   * PTY 启动 claude → 输出转发 → 退出自动重跑。
   *
   * 任一步骤失败抛错（任务状态仅在被置 fixing 后失败时才回退 failed）。
   */
  async start(taskId: string): Promise<void> {
    if (this._activeTaskId !== null) {
      throw new Error(
        `已有修复会话正在进行（任务 ${this._activeTaskId}），请先中止当前修复`,
      );
    }

    // 可修复性：本 run 内失败且 runner 停等。
    const ctx = this.runner.failureContext(taskId);
    if (ctx === null) {
      throw new Error(`任务 ${taskId} 当前不可修复（须为本 run 内停等中的失败任务）`);
    }

    // claude 可用性检测（失败抛明确错误，不建会话、不改状态）。
    await this.checkClaude();

    const prompt = this.buildPrompt(ctx);
    const env = await this.resolveClaudeEnv();
    const command = this.buildClaudeCommand(prompt, env);

    // 状态置 fixing（并发决策竞态下可能失败）。
    if (!this.runner.fix(taskId)) {
      throw new Error(`任务 ${taskId} 状态已变化，无法开始修复`);
    }

    const pty = this.ptyFactory();
    this._pty = pty;
    this._activeTaskId = taskId;
    this._aborting = false;

    try {
      await pty.open(command, {
        cols: 80,
        rows: 24,
        onData: (data) => this.emit('claude-output', data),
        onExit: (code) => this.handleExit(code),
        onError: (err) => this.handlePtyError(err),
      });
    } catch (err) {
      // PTY 启动失败 → 会话未建立，回退 failed，清理。
      this._activeTaskId = null;
      this._pty = null;
      this.runner.revertFix(taskId);
      throw new Error(`修复会话启动失败: ${(err as Error).message}`);
    }
  }

  /** 向当前修复会话写入输入（转发 pty-input）。 */
  write(data: string): void {
    if (this._pty === null || this._activeTaskId === null) {
      throw new Error('当前无活跃修复会话');
    }
    this._pty.write(data);
  }

  /**
   * 中止修复会话：终止远端 claude 进程（KILL + destroy），
   * 退出回调触发后任务置回 failed，会话资源清理。
   * 无活跃会话时是安全的 no-op。
   */
  abort(): void {
    if (this._activeTaskId === null) return;
    this._aborting = true;
    this._pty?.close();
  }

  // -- Internal -------------------------------------------------------------

  /** claude 可用性检测：`which claude && claude --version`。 */
  private async checkClaude(): Promise<void> {
    try {
      const result = await this.executor.exec(this.claudeCheckCommand);
      if (result.code !== 0) {
        throw new Error(this.claudeUnavailableMessage(result.stdout || result.stderr));
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('服务器上 claude 不可用')) {
        throw err;
      }
      throw new Error(this.claudeUnavailableMessage((err as Error).message));
    }
  }

  private claudeUnavailableMessage(detail: string): string {
    const detailSuffix = detail ? `（${detail.trim()}）` : '';
    return `服务器上 claude 不可用，请先执行 Claude Code 安装任务${detailSuffix}`;
  }

  /** 从 runner 失败上下文构造提示词（含 8KB 截断与 hint）。 */
  private buildPrompt(ctx: FailureContext): string {
    const task = this.runner.taskDef(ctx.taskId);
    return buildFixPrompt(
      {
        taskId: ctx.taskId,
        title: task?.title ?? ctx.taskId,
        description: task?.description,
        failStage: formatFailStage(ctx.stage),
        command: ctx.command || '（无，文件上传失败）',
        errorTail: ctx.errorTail,
        claudeHint: task?.claude_hint,
      },
      this.errorTailLimit,
    );
  }

  /**
   * 隧道代理注入：隧道未开启时先 open（proxy-injection 语义），
   * 返回代理环境变量表（空对象表示未配置隧道）。
   */
  private async resolveClaudeEnv(): Promise<Record<string, string>> {
    if (!this.tunnel) return {};
    if (this.tunnel.state !== 'open') {
      await this.tunnel.open();
    }
    const port = this.tunnel.remotePort;
    if (port === undefined) {
      throw new Error('隧道未建立，无法注入代理环境变量');
    }
    const proxyUrl = `http://127.0.0.1:${port}`;
    return {
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
    };
  }

  /**
   * 组装 claude 启动命令行：
   *   env K=V K2=V2 claude --dangerously-skip-permissions '<prompt>'
   * 环境注入走 env 命令前缀（OpenSSH sshd 忽略 exec env 选项）。
   */
  private buildClaudeCommand(prompt: string, env: Record<string, string>): string {
    const envTokens = Object.entries(env).map(
      ([key, value]) => `${key}=${shellQuote(value)}`,
    );
    const parts: string[] = [];
    if (envTokens.length > 0) {
      parts.push('env', ...envTokens);
    }
    parts.push(this.claudeCommand, '--dangerously-skip-permissions', shellQuote(prompt));
    return parts.join(' ');
  }

  /** claude 退出回调：正常退出 → 自动重跑；abort → 回退 failed。 */
  private handleExit(_code: number | null): void {
    const taskId = this._activeTaskId;
    if (taskId === null) return;

    this._activeTaskId = null;
    this._pty = null;
    const wasAbort = this._aborting;
    this._aborting = false;

    if (wasAbort) {
      // 用户中止 → 任务置回 failed（仍停等，重试/修复/跳过重新可用）。
      this.runner.revertFix(taskId);
      return;
    }

    // claude 正常退出（任意退出码）→ 自动重跑（复用 retry 语义）。
    // runner 已不再停等（并发 stop/skip）时不重试，仅清理。
    const snap = this.runner.snapshot();
    if (snap.awaitingDecision === taskId) {
      this.runner.retry(taskId);
    }
  }

  /** PTY 异常 → 按中止处理：回退 failed + 清理。 */
  private handlePtyError(_err: Error): void {
    const taskId = this._activeTaskId;
    if (taskId === null) return;
    this._activeTaskId = null;
    this._pty = null;
    this._aborting = false;
    this.runner.revertFix(taskId);
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** 把 runner 阶段标识格式化为提示词可读形式："command:N" → "command N"。 */
function formatFailStage(stage: string): string {
  const m = stage.match(/^command:(\d+)$/);
  return m ? `command ${m[1]}` : stage;
}
