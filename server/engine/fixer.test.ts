/**
 * server/engine/fixer.test.ts
 *
 * Fixer 单测（fakes）+ 集成测试（fenix-sshd-test 容器 + mock-claude.sh）。
 *
 * 覆盖 fix-workflow spec 与 claude-pty-session spec 的修复场景：
 *   - 提示词完整性：任务描述、失败命令、错误输出尾部、hint、行为目标
 *   - 触发后状态为 fixing（有 task-state 事件）
 *   - 修复成功后队列继续
 *   - 重跑仍失败可再决策
 *   - 中止修复回退失败态
 *   - 单会话拒绝（错误指明当前修复任务）
 *   - claude 缺失明确报错（无 PTY 会话建立）
 *   - 启动命令含 --dangerously-skip-permissions 与提示词
 *   - 隧道代理注入（env 命令前缀含 HTTP_PROXY 等）
 *   - PTY 输出转发生成 claude-output 事件、write 路由到修复会话
 */
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';
import { SshConnection } from '../ssh/connection.js';
import { SshExecutor } from '../ssh/executor.js';
import { PtySession, type PtyOpenOptions } from '../ssh/pty.js';
import { TaskRunner, type CommandExecutor, type FileUploader, type StreamTag } from './runner.js';
import type { TaskManifest } from '../../shared/schema.js';
import {
  Fixer,
  buildFixPrompt,
  truncateTail,
  shellQuote,
  type PtySessionLike,
} from './fixer.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  纯函数单测
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildFixPrompt / truncateTail / shellQuote', () => {
  it('提示词包含任务描述、失败阶段、命令、错误尾部、hint 和行为目标', () => {
    const prompt = buildFixPrompt({
      taskId: 'apt-install',
      title: '安装 Node.js',
      description: '通过 apt 源安装 Node.js 20.x',
      failStage: 'command 2',
      command: 'apt-get install -y nodejs',
      errorTail: 'E: Unable to locate package nodejs',
      claudeHint: '确认 VERSION_CODENAME 后调整源',
    });

    expect(prompt).toContain('安装 Node.js');
    expect(prompt).toContain('通过 apt 源安装 Node.js 20.x');
    expect(prompt).toContain('command 2');
    expect(prompt).toContain('apt-get install -y nodejs');
    expect(prompt).toContain('Unable to locate package');
    expect(prompt).toContain('确认 VERSION_CODENAME 后调整源');
    expect(prompt).toContain('不要改动其他系统配置');
  });

  it('hint 缺失时不出现"修复提示"行；无描述时标注（无）', () => {
    const prompt = buildFixPrompt({
      taskId: 'simple',
      title: '简单任务',
      failStage: 'verify',
      command: 'check',
      errorTail: 'error',
    });
    expect(prompt).not.toContain('修复提示');
    expect(prompt).toContain('（无）');
  });

  it('错误尾部超过 limit 截头留尾并标注省略；未超限原样返回', () => {
    const truncated = truncateTail('X'.repeat(16 * 1024), 4096);
    expect(truncated.length).toBeLessThan(16 * 1024);
    expect(truncated).toContain('前部');
    expect(truncated).toContain('已省略');
    expect(truncated.endsWith('X'.repeat(4096))).toBe(true);

    expect(truncateTail('short', 8 * 1024)).toBe('short');
  });

  it('shellQuote 正确转义单引号', () => {
    expect(shellQuote('hello')).toBe("'hello'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Fixer 单测（fakes）
// ═══════════════════════════════════════════════════════════════════════════════

// -- Fakes ------------------------------------------------------------------

type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'fixing' | 'skipped';

interface ExecBehavior {
  /** 返回码；缺省 0。 */
  code?: number;
  /** 前 N 次执行返回 7（失败），其后按 code。 */
  failTimes?: number;
  /** 失败执行时输出的 stderr 文本。 */
  errChunk?: string;
}

class FakeExecutor implements CommandExecutor {
  invocations: string[] = [];
  private behaviors = new Map<string, ExecBehavior>();

  setBehavior(command: string, opts: ExecBehavior): this {
    this.behaviors.set(command, { code: 0, ...opts });
    return this;
  }

  exec(
    command: string,
    options?: { onOutput?: (chunk: { stream: StreamTag; data: string }) => void; signal?: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    this.invocations.push(command);
    const b = this.behaviors.get(command);
    if (b === undefined) {
      options?.onOutput?.({ stream: 'stdout', data: `ok: ${command}` });
      return Promise.resolve({ code: 0, stdout: `ok: ${command}`, stderr: '' });
    }
    if ((b.failTimes ?? 0) > 0) {
      b.failTimes = b.failTimes! - 1;
      const msg = b.errChunk ?? 'simulated failure';
      options?.onOutput?.({ stream: 'stderr', data: msg });
      return Promise.resolve({ code: 7, stdout: '', stderr: msg });
    }
    const code = b.code ?? 0;
    if (code !== 0) {
      const msg = b.errChunk ?? 'simulated failure';
      options?.onOutput?.({ stream: 'stderr', data: msg });
      return Promise.resolve({ code, stdout: '', stderr: msg });
    }
    options?.onOutput?.({ stream: 'stdout', data: 'ok' });
    return Promise.resolve({ code: 0, stdout: 'ok', stderr: '' });
  }
}

class FakeUploader implements FileUploader {
  async upload() {}
}

class FakePty implements PtySessionLike {
  active = false;
  wasAborted = false;
  private _onExit: ((code: number | null) => void) | null = null;
  private _onData: ((data: string) => void) | null = null;

  /** open 收到的完整命令行与选项。 */
  command: string | null = null;
  openOptions: PtyOpenOptions | null = null;
  writeCalls: string[] = [];

  async open(command: string, options: PtyOpenOptions): Promise<void> {
    this.command = command;
    this.openOptions = options;
    this.active = true;
    this.wasAborted = false;
    this._onExit = options.onExit;
    this._onData = options.onData;
  }

  write(data: string): void {
    this.writeCalls.push(data);
  }

  resize(_cols: number, _rows: number): void {}

  /** 模拟远端进程正常退出（非 abort）。 */
  exit(code = 0): void {
    if (!this.active) return;
    this.active = false;
    this._onExit?.(code);
  }

  /** 模拟 abort：置 wasAborted 并触发退出回调。 */
  close(): void {
    if (!this.active) return;
    this.active = false;
    this.wasAborted = true;
    this._onExit?.(null);
  }

  /** 模拟 PTY 输出。 */
  emitData(data: string): void {
    this._onData?.(data);
  }
}

// -- Helpers ----------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeManifest(tasks: TaskManifest['tasks']): TaskManifest {
  return { meta: { name: 'fixer-test', version: '1' }, tasks };
}

function task(
  id: string,
  overrides: Partial<TaskManifest['tasks'][number]> = {},
): TaskManifest['tasks'][number] {
  return {
    id,
    title: id,
    commands: [`echo ${id}`],
    requires: [],
    files: [],
    needs_proxy: false,
    ...overrides,
  };
}

interface SetupResult {
  runner: TaskRunner;
  runnerExecutor: FakeExecutor;
  claudeExecutor: FakeExecutor;
  pty: FakePty;
  fixer: Fixer;
  runPromise: Promise<void>;
}

/**
 * 组装：runner（fake 执行器）先跑任务使其失败停等，再返回 fixer。
 * 调用方拿到 runPromise 后，结束时须 skip/retry 决策让队列跑完。
 */
function setup(taskDefs: TaskManifest['tasks'], tunnel?: { state: 'open'; remotePort: number }) {
  const runnerExecutor = new FakeExecutor();
  const claudeExecutor = new FakeExecutor();
  const runner = new TaskRunner({
    manifest: makeManifest(taskDefs),
    executor: runnerExecutor,
    uploader: new FakeUploader(),
    remoteRoot: '/root/init',
    filesRoot: '/tmp',
  });
  const pty = new FakePty();
  const fixer = new Fixer({
    runner,
    executor: claudeExecutor,
    ptyFactory: () => pty,
    tunnel: tunnel ?? null,
  });
  return { runner, runnerExecutor, claudeExecutor, pty, fixer, runPromise: undefined as unknown as Promise<void> };
}

async function waitForDecision(runner: TaskRunner, taskId: string): Promise<void> {
  await vi.waitFor(() => {
    expect(runner.snapshot().awaitingDecision).toBe(taskId);
  }, { timeout: 3_000 });
}

/** 从完整命令行中提取 shell-quoted 的 prompt 文本。 */
function extractPrompt(command: string): string {
  const match = command.match(/--dangerously-skip-permissions\s+'([\s\S]*)'$/);
  if (!match) throw new Error(`未找到 shell-quoted prompt: ${command}`);
  return match[1];
}

async function startFixAndFinish(setupResult: SetupResult, taskId: string): Promise<void> {
  const { runner, fixer } = setupResult;
  await fixer.start(taskId);
  fixer.abort();
  runner.skip(taskId);
  await setupResult.runPromise;
}

// -- Tests ------------------------------------------------------------------

describe('Fixer 单测', () => {
  it('提示词内容完整：title/description/stage/command/hint 目标均出现，命令含跳过权限参数', async () => {
    const s = setup([
      task('apt', {
        title: '安装 Node.js',
        description: '通过 apt 源安装 Node.js 20.x',
        commands: ['apt-get install -y nodejs'],
        claude_hint: '确认 VERSION_CODENAME 后调整源',
      }),
    ]);
    const { runner, runnerExecutor } = s;
    runnerExecutor.setBehavior('apt-get install -y nodejs', { code: 7 });

    s.runPromise = runner.run(['apt']);
    await waitForDecision(runner, 'apt');
    await s.fixer.start('apt');
    await s.fixer.abort();

    const cmd = s.pty.command!;
    expect(cmd).toContain('--dangerously-skip-permissions');
    const prompt = extractPrompt(cmd);
    expect(prompt).toContain('安装 Node.js');
    expect(prompt).toContain('通过 apt 源安装 Node.js 20.x');
    expect(prompt).toContain('command 1');
    expect(prompt).toContain('apt-get install -y nodejs');
    expect(prompt).toContain('确认 VERSION_CODENAME 后调整源');
    expect(prompt).toContain('不要改动其他系统配置');
    // 提示词含错误输出尾部（mock 产生的 stderr 前缀可见）
    expect(prompt).toContain('错误输出尾部');

    runner.skip('apt');
    await s.runPromise;
  });

  it('错误输出尾部超限被 8KB 截断（含省略标注）', async () => {
    const s = setup([task('noisy', { commands: ['echo noisy'] })]);
    const { runner, runnerExecutor } = s;
    // 失败时输出 20KB 错误日志
    const bigError = 'E'.repeat(20 * 1024);
    runnerExecutor.setBehavior('echo noisy', { code: 7, errChunk: bigError });

    s.runPromise = runner.run(['noisy']);
    await waitForDecision(runner, 'noisy');
    await s.fixer.start('noisy');
    await s.fixer.abort();

    const prompt = extractPrompt(s.pty.command!);
    expect(prompt).toContain('已省略');
    // mock 错误日志全部是 E，截断后尾部仍是 E 块
    expect(prompt.endsWith('E'.repeat(4096) + '```')).toBe(false); // 尾部是 E 串
    // 错误尾部区不超过 8KB
    expect(prompt.length).toBeLessThan(12 * 1024);

    runner.skip('noisy');
    await s.runPromise;
  });

  it('触发后状态为 fixing 且发出 task-state 事件', async () => {
    const s = setup([task('X')]);
    const { runner, runnerExecutor } = s;
    runnerExecutor.setBehavior('echo X', { code: 1 });
    const stateEvents: Array<{ taskId: string; status: TaskStatus }> = [];
    runner.on('task-state', (taskId: string, status: TaskStatus) =>
      stateEvents.push({ taskId, status }));

    s.runPromise = runner.run(['X']);
    await waitForDecision(runner, 'X');
    expect(runner.snapshot().states['X']).toBe('failed');

    await s.fixer.start('X');
    expect(runner.snapshot().states['X']).toBe('fixing');
    expect(stateEvents.some((e) => e.taskId === 'X' && e.status === 'fixing')).toBe(true);

    s.fixer.abort();
    runner.skip('X');
    await s.runPromise;
  });

  it('修复成功（claude 正常退出）自动重跑：队列继续、后续任务自动开始', async () => {
    const s = setup([task('ok'), task('flaky'), task('last')]);
    const { runner, runnerExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo flaky', { failTimes: 1 });
    const stateEvents: string[] = [];
    runner.on('task-state', (taskId: string, status: TaskStatus) =>
      stateEvents.push(`${taskId}:${status}`));

    s.runPromise = runner.run(['ok', 'flaky', 'last']);
    await waitForDecision(runner, 'flaky');
    await fixer.start('flaky');
    expect(runner.snapshot().states['flaky']).toBe('fixing');

    pty.exit(0); // claude 正常退出 → 自动重跑

    await s.runPromise;

    expect(runner.snapshot().states).toMatchObject({
      ok: 'success',
      flaky: 'success',
      last: 'success',
    });
    expect(stateEvents).toContain('flaky:fixing');
    expect(stateEvents).toContain('flaky:running');
    expect(stateEvents).toContain('flaky:success');
  });

  it('重跑仍失败可再决策：claude 退出后重跑仍失败 → 回 failed 停等', async () => {
    const s = setup([task('stubborn')]);
    const { runner, runnerExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo stubborn', { code: 7 }); // 始终失败

    s.runPromise = runner.run(['stubborn']);
    await waitForDecision(runner, 'stubborn');
    await fixer.start('stubborn');
    expect(runner.snapshot().states['stubborn']).toBe('fixing');

    pty.exit(0); // 修了但没修好，重跑仍失败

    // 等待重跑完成并重新停等（状态回 failed）
    await vi.waitFor(() => {
      expect(runner.snapshot().states['stubborn']).toBe('failed');
      expect(runner.snapshot().awaitingDecision).toBe('stubborn');
    }, { timeout: 5_000 });
    expect(fixer.activeTaskId).toBeNull();

    // 重试/修复/跳过重新可用
    runner.skip('stubborn');
    await s.runPromise;
    expect(runner.snapshot().states['stubborn']).toBe('skipped');
  });

  it('中止修复回退失败态：abort 终止会话、任务回到 failed、可再次决策', async () => {
    const s = setup([task('abort-me')]);
    const { runner, runnerExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo abort-me', { code: 1 });

    s.runPromise = runner.run(['abort-me']);
    await waitForDecision(runner, 'abort-me');
    await fixer.start('abort-me');
    expect(runner.snapshot().states['abort-me']).toBe('fixing');

    fixer.abort();

    expect(runner.snapshot().states['abort-me']).toBe('failed');
    expect(fixer.activeTaskId).toBeNull();
    expect(fixer.busy).toBe(false);
    expect(pty.wasAborted).toBe(true);

    // 会话结束后会话可再次开始（新 ptyFactory 实例由调用方提供）
    runner.skip('abort-me');
    await s.runPromise;
  });

  it('单会话约束：会话进行中新 start 被拒且错误指明当前任务', async () => {
    const s = setup([task('A')]);
    const { runner, runnerExecutor, fixer } = s;
    runnerExecutor.setBehavior('echo A', { code: 1 });

    s.runPromise = runner.run(['A']);
    await waitForDecision(runner, 'A');
    await fixer.start('A');
    expect(fixer.busy).toBe(true);

    await expect(fixer.start('A')).rejects.toThrow(/已有修复会话正在进行（任务 A）/);

    fixer.abort();
    runner.skip('A');
    await s.runPromise;
  });

  it('不可修复的任务被拒绝：未失败的 runner 任务 start 抛错', async () => {
    const s = setup([task('A')]);
    const { runner, fixer } = s;
    await expect(fixer.start('A')).rejects.toThrow(/不可修复/);
    expect(runner.snapshot().states['A']).toBeUndefined();
  });

  it('claude 缺失时明确报错：报错含"claude 不可用"，无 PTY 会话建立', async () => {
    const s = setup([task('T')]);
    const { runner, runnerExecutor, claudeExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo T', { code: 1 });
    claudeExecutor.setBehavior('which claude && claude --version', { code: 127 });

    s.runPromise = runner.run(['T']);
    await waitForDecision(runner, 'T');

    await expect(fixer.start('T')).rejects.toThrow(/claude 不可用|请先执行 Claude Code 安装任务/);
    expect(pty.command).toBeNull(); // 无 PTY 会话建立
    expect(runner.snapshot().states['T']).toBe('failed'); // 状态未变

    runner.skip('T');
    await s.runPromise;
  });

  it('PTY 输出转为 claude-output 事件；write 转发到会话', async () => {
    const s = setup([task('X')]);
    const { runner, runnerExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo X', { code: 1 });
    const output: string[] = [];
    fixer.on('claude-output', (d: string) => output.push(d));

    s.runPromise = runner.run(['X']);
    await waitForDecision(runner, 'X');
    await fixer.start('X');

    pty.emitData('line1\n');
    pty.emitData('line2\n');
    expect(output).toEqual(['line1\n', 'line2\n']);

    fixer.write('user-input');
    expect(pty.writeCalls).toEqual(['user-input']);

    fixer.abort();
    runner.skip('X');
    await s.runPromise;
  });

  it('隧道开启时注入代理环境变量：启动命令为 env 前缀 + claude', async () => {
    const s = setup([task('T')], { state: 'open', remotePort: 39999 });
    const { runner, runnerExecutor, pty, fixer } = s;
    runnerExecutor.setBehavior('echo T', { code: 1 });

    s.runPromise = runner.run(['T']);
    await waitForDecision(runner, 'T');

    await fixer.start('T');
    const cmd = pty.command!;
    expect(cmd).toContain("http_proxy='http://127.0.0.1:39999'");
    expect(cmd).toContain('HTTPS_PROXY');
    expect(cmd).toContain('http://127.0.0.1:39999');
    expect(cmd).toContain('claude --dangerously-skip-permissions');
    // env 前缀在 claude 之前
    expect(cmd.indexOf('env') ).toBeLessThan(cmd.indexOf('claude'));

    fixer.abort();
    runner.skip('T');
    await s.runPromise;
  });

  it('无活跃会话时 write 抛错', () => {
    const s = setup([task('X')]);
    expect(() => s.fixer.write('data')).toThrow(/无活跃修复会话/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Fixer 集成测试（fenix-sshd-test 容器 + mock-claude）
// ═══════════════════════════════════════════════════════════════════════════════

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

async function installMockClaude(executor: SshExecutor): Promise<void> {
  const mockPath = resolve(__dirname, '../ssh/fixtures/mock-claude.sh');
  const mockContent = readFileSync(mockPath, 'utf8');
  await executor.exec(`cat > /usr/local/bin/claude << 'MOCKEOF'\n${mockContent}\nMOCKEOF\nchmod +x /usr/local/bin/claude`);
}

describe('Fixer 集成（fenix-sshd-test + mock-claude）', () => {
  let conn: SshConnection;
  let remoteBase: string;

  beforeAll(async (ctx) => {
    const c = new Client();
    const up = await new Promise<boolean>((resolve) => {
      c.once('ready', () => { c.end(); resolve(true); });
      c.once('error', () => resolve(false));
      c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 5_000 });
    });
    if (!up) { ctx.skip(); return; }

    conn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await conn.connect();
    remoteBase = `/root/fixer-integ-${Date.now()}`;

    const executor = new SshExecutor(conn);
    await executor.exec(`mkdir -p ${remoteBase}`);
    await installMockClaude(executor);
    // 修复 wrapper：模拟 claude 创建标记使重跑成功
    await executor.exec(
      `cat > /root/mock-fix-wrapper.sh << 'WEOF'\n` +
      `#!/bin/bash\n` +
      `export MOCK_CLAUDE_RUN="touch ${remoteBase}/fixed-marker"\n` +
      `export MOCK_CLAUDE_TEXT="Mock claude 修复完成"\n` +
      `exec /usr/local/bin/claude "$@"\n` +
      `WEOF\n` +
      `chmod +x /root/mock-fix-wrapper.sh`,
    );
    // noop wrapper：退出 0 但不修复（供"重跑仍失败"场景）
    await executor.exec(
      `cat > /root/mock-fix-noop.sh << 'WEOF'\n` +
      `#!/bin/bash\n` +
      `export MOCK_CLAUDE_TEXT="已退出但未修复"\n` +
      `exec /usr/local/bin/claude "$@"\n` +
      `WEOF\n` +
      `chmod +x /root/mock-fix-noop.sh`,
    );
    // sleep wrapper：模拟长会话（供 abort 场景）
    await executor.exec(
      `cat > /root/mock-fix-sleep.sh << 'WEOF'\n` +
      `#!/bin/bash\n` +
      `export MOCK_CLAUDE_SLEEP_SEC=10\n` +
      `export MOCK_CLAUDE_TEXT="thinking..."\n` +
      `exec /usr/local/bin/claude "$@"\n` +
      `WEOF\n` +
      `chmod +x /root/mock-fix-sleep.sh`,
    );
  }, 20_000);

  afterAll(async () => {
    if (conn?.state === 'ready') {
      const executor = new SshExecutor(conn);
      await executor.exec(
        `rm -rf ${remoteBase} /root/mock-fix-wrapper.sh /root/mock-fix-noop.sh /root/mock-fix-sleep.sh`,
      ).catch(() => {});
    }
    conn?.close();
  });

  it('修复成功（退出 0）自动重跑：标记创建 → 任务 success → 队列后续继续', async () => {
    const executor = new SshExecutor(conn);
    const runner = new TaskRunner({
      manifest: makeManifest([
        task('flaky', { title: 'flaky-task', commands: [`test -f ${remoteBase}/fixed-marker || exit 1`] }),
        task('after', { commands: ['echo after-ok'] }),
      ]),
      executor,
      uploader: { upload: async () => {} },
      remoteRoot: remoteBase,
      filesRoot: '/tmp',
    });
    const fixer = new Fixer({
      runner,
      executor,
      ptyFactory: () => new PtySession(conn),
      claudeCommand: '/root/mock-fix-wrapper.sh',
    });
    const stateEvents: Array<{ taskId: string; status: TaskStatus }> = [];
    runner.on('task-state', (taskId: string, status: TaskStatus) =>
      stateEvents.push({ taskId, status }));

    const runPromise = runner.run(['flaky', 'after']);
    await waitForDecision(runner, 'flaky');
    expect(runner.snapshot().states['flaky']).toBe('failed');

    await fixer.start('flaky');
    // 状态经 fixing 并最终 success（mock 快速退出触发自动重跑）
    await vi.waitFor(() => {
      expect(runner.snapshot().states['flaky']).toBe('success');
    }, { timeout: 15_000 });

    await runPromise;

    expect(runner.snapshot().states['after']).toBe('success');
    expect(stateEvents.some((e) => e.taskId === 'flaky' && e.status === 'fixing')).toBe(true);
    const check = await executor.exec(`test -f ${remoteBase}/fixed-marker && echo exists`);
    expect(check.stdout).toContain('exists');
  }, 20_000);

  it('重跑仍失败：mock 未修复 → 重跑失败 → 回 failed 停等，可再次决策', async () => {
    const executor = new SshExecutor(conn);
    const runner = new TaskRunner({
      manifest: makeManifest([
        task('stubborn', { commands: ['echo fail-stubborn && exit 1'] }),
      ]),
      executor,
      uploader: { upload: async () => {} },
      remoteRoot: remoteBase,
      filesRoot: '/tmp',
    });
    const fixer = new Fixer({
      runner,
      executor,
      ptyFactory: () => new PtySession(conn),
      claudeCommand: '/root/mock-fix-noop.sh',
    });

    const runPromise = runner.run(['stubborn']);
    await waitForDecision(runner, 'stubborn');
    await fixer.start('stubborn');

    // claude 退出后自动重跑仍失败 → fixing → running → failed
    await vi.waitFor(() => {
      expect(runner.snapshot().states['stubborn']).toBe('failed');
    }, { timeout: 15_000 });
    await waitForDecision(runner, 'stubborn');
    expect(fixer.activeTaskId).toBeNull();

    runner.skip('stubborn');
    await runPromise;
  }, 20_000);

  it('中止修复回退失败态：abort 杀掉运行中的 claude，任务回到 failed', async () => {
    const executor = new SshExecutor(conn);
    const runner = new TaskRunner({
      manifest: makeManifest([
        task('kill-me', { commands: ['echo kill-test && exit 1'] }),
      ]),
      executor,
      uploader: { upload: async () => {} },
      remoteRoot: remoteBase,
      filesRoot: '/tmp',
    });
    const fixer = new Fixer({
      runner,
      executor,
      ptyFactory: () => new PtySession(conn),
      claudeCommand: '/root/mock-fix-sleep.sh',
    });

    const runPromise = runner.run(['kill-me']);
    await waitForDecision(runner, 'kill-me');
    await fixer.start('kill-me');
    expect(runner.snapshot().states['kill-me']).toBe('fixing');
    expect(fixer.activeTaskId).toBe('kill-me');

    // claude 运行中（sleep 10s）中止
    await new Promise((r) => setTimeout(r, 800));
    fixer.abort();

    await vi.waitFor(() => {
      expect(runner.snapshot().states['kill-me']).toBe('failed');
    }, { timeout: 10_000 });
    expect(fixer.activeTaskId).toBeNull();

    runner.skip('kill-me');
    await runPromise;
  }, 20_000);
});