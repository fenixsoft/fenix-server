/**
 * server/handlers.ts
 *
 * WebSocket 会话 handler 装配层 —— 传输层（ws 消息协议）与后端引擎之间的
 * 最后一块粘合（add-ws-handlers SPEC）。
 *
 * 把 shared/messages.ts 的 11 种 ClientMessage 逐个注册到 MessageRouter：
 *   connect        → 建立/拒绝 SshConnection（密码认证），成功物化任务清单并下发快照
 *   exec/stop/retry/skip → 驱动 TaskRunner（依赖闭包校验 / 状态机合法性检查）
 *   fixWithClaude  → 驱动 ClaudeFixer（claude 不可用回可区分错误）
 *   pty-input      → 写入活跃修复会话 stdin
 *   tunnel-open/tunnel-test → 驱动 TunnelManager
 *   disconnect     → 全量清理会话资源
 *   snapshot       → 全量状态补发（断线重连用）
 *
 * 事件翻译集中在 SessionContext 内一处绑定：runner 的 task-state/log/progress/
 * stopped-state/queue-finished、fixer 的 claude-output、tunnel 的 status 事件
 * 一一映射为 ServerMessage 广播；清理时统一解除绑定，避免跨会话监听器泄漏。
 *
 * 单会话（single-session）语义：同一时刻至多一个 SSH 会话；新 connect 到达时
 * 若已有活跃会话则拒绝（回 SESSION_EXISTS）而非静默替换。
 *
 * 引擎装配走 SessionDeps.engineFactory 工厂（缺省真实引擎）——单元测试注入
 * fake 引擎直接驱动 router.dispatch 断言广播序列，不必起 HTTP / 真连 SSH。
 */
import { parse as parseYaml } from 'yaml';
import { resolve } from 'node:path';
import { SshConnection, type SshConnectionConfig } from './ssh/connection.js';
import { SshExecutor } from './ssh/executor.js';
import { SshSftp } from './ssh/sftp.js';
import { PtySession } from './ssh/pty.js';
import {
  TunnelManager,
  type TunnelState,
  type TunnelStatus,
  type ConnectivityResult,
} from './ssh/tunnel.js';
import {
  TaskRunner,
  createSftpUploader,
  type RunnerSnapshot,
  type StreamTag as RunnerStreamTag,
  type TaskStatus as RunnerTaskStatus,
} from './engine/runner.js';
import { Fixer } from './engine/fixer.js';
import { loadManifest } from './engine/manifest.js';
import { parseTaskManifest, type TaskManifest } from '../shared/schema.js';
import type { AppConfig } from './config.js';
import type { MessageRouter } from './ws.js';
import type { ServerMessage, TunnelStatusPayload } from '../shared/messages.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** 配置读取接口 —— AppConfigManager 结构性满足；测试注入 fake。 */
export interface ConfigProvider {
  get(): Promise<AppConfig>;
}

/** 日志接口（最小化；Fastify 的 logger 结构性满足）。 */
export interface LoggerLike {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * SshConnection 最小接口 —— handlers 只消费这些成员（建连状态机 +
 * 错误类别）。真实 SshConnection 结构性满足；测试注入 fake。
 */
export interface SshConnectionLike {
  readonly state: 'connecting' | 'ready' | 'closed' | 'error';
  readonly errorCategory?: string;
  readonly error?: Error;
  connect(): Promise<void>;
  close(): void;
}

/**
 * TaskRunner 最小接口（事件成员走 EventEmitter on/off）。
 * 真实 TaskRunner 结构性满足；测试注入 fake。
 */
export interface RunnerLike {
  readonly snapshotStates: Readonly<Record<string, RunnerTaskStatus>>;
  run(taskIds: string[], options?: { reset?: boolean }): Promise<void>;
  stop(): void;
  retry(taskId: string): void;
  skip(taskId: string): void;
  snapshot(): RunnerSnapshot;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/** ClaudeFixer 最小接口。真实 Fixer 结构性满足；测试注入 fake。 */
export interface FixerLike {
  readonly busy: boolean;
  start(taskId: string): Promise<void>;
  write(data: string): void;
  abort(): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/** TunnelManager 最小接口。真实 TunnelManager 结构性满足；测试注入 fake。 */
export interface TunnelLike {
  readonly state: TunnelState;
  readonly remotePort?: number;
  open(): Promise<TunnelStatus>;
  close(): Promise<void>;
  testConnectivity(url?: string): Promise<ConnectivityResult>;
  getStatus(): TunnelStatus;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/** 引擎装配产物（真实或 fake）。 */
export interface EngineBundle {
  runner: RunnerLike;
  fixer: FixerLike;
  tunnel: TunnelLike | null;
}

/** 引擎装配函数签名。 */
export type SessionEngineFactory = (
  ctx: SessionContext,
  conn: SshConnectionLike,
  manifest: TaskManifest,
  proxy: string | undefined,
) => EngineBundle;

/** registerSessionHandlers 的注入依赖（供测试替换 fake 引擎与路径）。 */
export interface SessionDeps {
  /** 配置管理器（clientProxy 兜底来源）。 */
  config: ConfigProvider;
  /** 内置清单路径；缺省 <CWD>/assets/tasks.yaml。 */
  builtinManifestPath?: string;
  /** runner 上传文件本地根目录（filesRoot），缺省 CWD。 */
  filesRoot?: string;
  /** runner 远端上传根目录（remoteRoot），缺省 /root/server-init。 */
  remoteRoot?: string;
  /** 日志；缺省静默。 */
  logger?: LoggerLike;
  /** 建连工厂（缺省 new SshConnection）。 */
  createConnection?: (opts: SshConnectionConfig) => SshConnectionLike;
  /** 引擎装配工厂（缺省装配真实引擎）。 */
  engineFactory?: SessionEngineFactory;
}

/**
 * 会话通道最小接口 —— 真实 WebSocket（ws 包）结构性满足；
 * 单元测试注入 fake 以断言 broadcast 的 readyState 检查与发送序列。
 */
export interface SessionChannel {
  readonly readyState: number;
  send(data: string): void;
  once(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}

// ---------------------------------------------------------------------------
//  SessionContext —— 单会话生命周期与事件翻译
// ---------------------------------------------------------------------------

/**
 * 单客户端语义下的会话上下文：持有 connection / runner / fixer / tunnel
 * 四件引擎的引用与生命周期（互斥、清理顺序、事件绑定解绑），并提供统一
 * 广播出口（broadcast 前检查 socket readyState）。
 *
 * 清理顺序（teardown）：解绑引擎事件 → 中止修复会话 → 停止在途执行 →
 * 关闭隧道 → 关闭 SSH 连接 → 复位引用。幂等。
 */
export class SessionContext {
  private connection: SshConnectionLike | null = null;
  private runner: RunnerLike | null = null;
  private fixer: FixerLike | null = null;
  private tunnel: TunnelLike | null = null;
  private manifest: TaskManifest | null = null;
  private clientProxy: string | undefined;
  /** 引擎事件绑定回收器：teardown 时逐一执行，解除跨会话监听器。 */
  private readonly unbindTasks: Array<() => void> = [];

  private socket: SessionChannel | null = null;
  private socketCloseBinder: (() => void) | null = null;

  constructor(private readonly deps: SessionDeps) {}

  // -- 状态查询 -------------------------------------------------------------

  /** 是否有活跃（ready/connecting）SSH 会话 —— 新 connect 的拒绝依据。 */
  hasActiveSession(): boolean {
    const state = this.connection?.state;
    return state === 'ready' || state === 'connecting';
  }

  /** SSH 已就绪且引擎上下文已装配。 */
  isReady(): boolean {
    return this.connection !== null && this.connection.state === 'ready' && this.runner !== null;
  }

  get runnerEngine(): RunnerLike | null {
    return this.runner;
  }

  get fixerEngine(): FixerLike | null {
    return this.fixer;
  }

  get tunnelEngine(): TunnelLike | null {
    return this.tunnel;
  }

  get currentManifest(): TaskManifest | null {
    return this.manifest;
  }

  // -- 配置读取 -------------------------------------------------------------

  /** 读取 config.json 中的 clientProxy（用于 connect 时的兜底）。 */
  async getDefaultClientProxy(): Promise<string | undefined> {
    try {
      const config = await this.deps.config.get();
      return config.clientProxy;
    } catch {
      return undefined;
    }
  }

  /** 建连工厂入口：缺省 `new SshConnection`，测试注入 fake。 */
  createConnection(opts: SshConnectionConfig): SshConnectionLike {
    const factory = this.deps.createConnection;
    return factory !== undefined ? factory(opts) : new SshConnection(opts);
  }

  // -- 通道绑定 -------------------------------------------------------------

  /**
   * 绑定当前 WebSocket（单会话语义：新 socket 到达时重绑 close 兜底清理）。
   * close 触发时执行与 disconnect 相同的清理路径（任务 2.4）。
   */
  attachSocket(socket: SessionChannel): void {
    if (this.socket === socket) return;
    if (this.socketCloseBinder) {
      this.socket?.removeListener('close', this.socketCloseBinder);
      this.socketCloseBinder = null;
    }
    this.socket = socket;
    const onClose = (): void => {
      this.socketCloseBinder = null;
      void this.teardown();
    };
    this.socketCloseBinder = onClose;
    socket.once('close', onClose);
  }

  /** 统一广播出口：socket 未打开时不发送（design 决策 2）。 */
  broadcast(msg: ServerMessage): void {
    if (this.socket !== null && this.socket.readyState === 1 /* WebSocket.OPEN */) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  // -- 会话建立 -------------------------------------------------------------

  /**
   * 装载任务清单：payload 携带自定义 YAML 文本（manifestYaml 字段，与前端
   * manifestSource 语义对齐）→ shared schema 校验；否则读内置清单
   * assets/tasks.yaml。失败回 MANIFEST_INVALID 并保持未连接态。
   */
  async resolveManifest(payload: Record<string, unknown>): Promise<TaskManifest | null> {
    const yamlText = typeof payload['manifestYaml'] === 'string' ? payload['manifestYaml'] : undefined;
    if (yamlText !== undefined && yamlText.trim() !== '') {
      let data: unknown;
      try {
        data = parseYaml(yamlText);
      } catch (err) {
        this.broadcast({
          type: 'error',
          payload: {
            code: 'MANIFEST_INVALID',
            message: `自定义清单 YAML 解析失败: ${(err as Error).message}`,
          },
        });
        return null;
      }
      const parsed = parseTaskManifest(data);
      if (!parsed.ok) {
        const first = parsed.errors[0];
        const detail = first
          ? `首个校验错误路径: ${first.path}（${first.reason}）`
          : '无法通过校验';
        this.broadcast({
          type: 'error',
          payload: { code: 'MANIFEST_INVALID', message: `自定义清单校验失败，${detail}` },
        });
        return null;
      }
      return parsed.manifest;
    }

    // 内置清单兜底（add-builtin-tasks-e2e 交付的 assets/tasks.yaml）。
    const path = this.deps.builtinManifestPath ?? resolve(process.cwd(), 'assets/tasks.yaml');
    const loaded = await loadManifest(path);
    if (!loaded.ok) {
      this.broadcast({
        type: 'error',
        payload: { code: 'MANIFEST_INVALID', message: `内置清单加载失败: ${loaded.error.reason}` },
      });
      return null;
    }
    return loaded.manifest;
  }

  /** 记录建连用的 SshConnection（替换旧连接前先关闭）。 */
  setConnection(conn: SshConnectionLike): void {
    const old = this.connection;
    if (old !== null && old !== conn) old.close();
    this.connection = conn;
  }

  /** 建连失败 / 清理时复位连接引用（连接对象自身已处于终态）。 */
  clearConnection(): void {
    this.connection = null;
  }

  /** 仅断开 SSH 连接（connect 失败路径），保留引擎引用不变。 */
  closeConnection(): void {
    const conn = this.connection;
    this.connection = null;
    if (conn !== null) conn.close();
  }

  /**
   * 连接成功后装配 runner / fixer / tunnel 引擎并绑定事件翻译。
   * clientProxy 取 connect payload，兜底读 config.json。
   */
  initializeEngines(manifest: TaskManifest, proxy: string | undefined): void {
    const conn = this.connection!;
    const fallback: SessionEngineFactory = (_ctx, c, m, p) => this.createRealEngines(c, m, p);
    const factory: SessionEngineFactory = this.deps.engineFactory ?? fallback;
    const engines = factory(this, conn, manifest, proxy);

    this.runner = engines.runner;
    this.fixer = engines.fixer;
    this.tunnel = engines.tunnel;
    this.manifest = manifest;
    this.clientProxy = proxy;

    this.bindEngineEvents();
  }

  /**
   * 缺省引擎装配：真实 SshExecutor / SshSftp / PtySession / TunnelManager /
   * TaskRunner / Fixer。conn 在此路径下恒为真实 SshConnection
   * （createConnection 缺省 `new SshConnection`），类型断言安全。
   */
  private createRealEngines(
    conn: SshConnectionLike,
    manifest: TaskManifest,
    proxy: string | undefined,
  ): EngineBundle {
    const filesRoot = this.deps.filesRoot ?? process.cwd();
    const realConn = conn as SshConnection;

    const executor = new SshExecutor(realConn);
    const uploader = createSftpUploader(new SshSftp(realConn), filesRoot);
    const runner = new TaskRunner({
      manifest,
      executor,
      uploader,
      remoteRoot: this.deps.remoteRoot,
      filesRoot,
    });

    let tunnel: TunnelManager | null = null;
    if (proxy !== undefined && proxy !== '') {
      tunnel = new TunnelManager(realConn, { clientProxy: proxy });
    }

    const ptyFactory = () => new PtySession(realConn);
    const fixer = new Fixer({ runner, executor, ptyFactory, tunnel });

    return { runner, fixer, tunnel };
  }

  // -- 事件翻译 -------------------------------------------------------------

  /** 装配点内一次完成全部引擎事件 → ServerMessage 的绑定，回收器入栈。 */
  private bindEngineEvents(): void {
    const runner = this.runner!;
    const fixer = this.fixer;
    const tunnel = this.tunnel;

    const onTaskState = (taskId: string, status: RunnerTaskStatus): void => {
      this.broadcast({ type: 'task-state', payload: { taskId, status } });
    };
    const onLog = (chunk: { taskId: string; stream: RunnerStreamTag; data: string }): void => {
      this.broadcast({
        type: 'log',
        payload: { taskId: chunk.taskId, stream: chunk.stream, data: chunk.data },
      });
    };
    const onProgress = (completed: number, total: number): void => {
      this.broadcast({ type: 'progress', payload: { completed, total } });
    };
    const onStoppedState = (snapshot: RunnerSnapshot): void => {
      // stop 后快照补发：逐任务 task-state + progress 重放，前端无需新消息类型即可复位。
      for (const task of this.manifest?.tasks ?? []) {
        const status = snapshot.states[task.id] ?? 'pending';
        this.broadcast({ type: 'task-state', payload: { taskId: task.id, status } });
      }
      this.broadcast({
        type: 'progress',
        payload: { completed: snapshot.completed, total: snapshot.total },
      });
    };
    const onQueueFinished = (): void => {
      // 队列结束：stop 路径已由 stopped-state 重放；completed 路径补发最终进度
      // 确保前端进度与 runner 一致（runner 本身串行，事件按序到达）。
      const snap = runner.snapshot();
      this.broadcast({ type: 'progress', payload: { completed: snap.completed, total: snap.total } });
    };

    runner.on('task-state', onTaskState);
    runner.on('log', onLog);
    runner.on('progress', onProgress);
    runner.on('stopped-state', onStoppedState);
    runner.on('queue-finished', onQueueFinished);
    this.unbindTasks.push(() => {
      runner.off('task-state', onTaskState);
      runner.off('log', onLog);
      runner.off('progress', onProgress);
      runner.off('stopped-state', onStoppedState);
      runner.off('queue-finished', onQueueFinished);
    });

    if (fixer !== null) {
      const onClaudeOutput = (data: string): void => {
        this.broadcast({ type: 'claude-output', payload: { data } });
      };
      fixer.on('claude-output', onClaudeOutput);
      this.unbindTasks.push(() => fixer.off('claude-output', onClaudeOutput));
    }

    if (tunnel !== null) {
      const onTunnelStatus = (status: TunnelStatus): void => {
        this.broadcast({ type: 'tunnel-status', payload: toTunnelStatusPayload(status) });
      };
      tunnel.on('status', onTunnelStatus);
      this.unbindTasks.push(() => tunnel.off('status', onTunnelStatus));
    }
  }

  // -- 快照 -----------------------------------------------------------------

  /**
   * connect 成功后回发任务清单与快照：先 manifest 后全量 pending 状态 + progress 0/N。
   * 下发顺序保证（design 决策 2）：前端先有清单定义（taskId→requires 闭合）
   * 再消费状态流，避免「先有状态无定义」竞态。
   */
  sendManifestSnapshot(): void {
    const manifest = this.manifest;
    if (manifest === null) return;
    this.broadcast({ type: 'manifest', payload: { manifest } });
    for (const task of manifest.tasks) {
      this.broadcast({ type: 'task-state', payload: { taskId: task.id, status: 'pending' } });
    }
    this.broadcast({ type: 'progress', payload: { completed: 0, total: manifest.tasks.length } });
  }

  /** snapshot 消息的全量状态：先 manifest 补发 → 任务状态 + 进度 + 隧道状态。 */
  sendFullSnapshot(): void {
    const manifest = this.manifest;
    const runner = this.runner;

    if (manifest === null || runner === null) {
      // 无活跃会话 → 空态快照：progress 0/0 + 隧道关闭态，不回 error。
      this.broadcast({ type: 'progress', payload: { completed: 0, total: 0 } });
      this.broadcast({ type: 'tunnel-status', payload: { open: false } });
      return;
    }

    // 重连补发同样先 manifest：前端用当前会话清单重建视图，再消费状态流。
    this.broadcast({ type: 'manifest', payload: { manifest } });

    const states = runner.snapshotStates;
    for (const task of manifest.tasks) {
      this.broadcast({
        type: 'task-state',
        payload: { taskId: task.id, status: states[task.id] ?? 'pending' },
      });
    }
    // 未 run 过（total 为 0）时进度以清单全量为分母。
    const snap = runner.snapshot();
    if (snap.total > 0) {
      this.broadcast({ type: 'progress', payload: { completed: snap.completed, total: snap.total } });
    } else {
      this.broadcast({ type: 'progress', payload: { completed: 0, total: manifest.tasks.length } });
    }
    this.broadcast({ type: 'tunnel-status', payload: toTunnelStatusPayload(this.tunnel) });
  }

  // -- 清理 -----------------------------------------------------------------

  /**
   * 完全清理会话资源：终止在途执行与修复会话、关闭隧道与 SSH 连接、
   * 解绑全部引擎事件、复位引用。幂等 —— 无会话时调用是安全的 no-op。
   */
  async teardown(): Promise<void> {
    // 1) 解除全部引擎事件绑定（防跨会话监听器泄漏）
    for (const unbind of this.unbindTasks.splice(0)) {
      unbind();
    }

    // 2) 终止修复会话（同步触发，退出回调将任务置回 failed）
    this.fixer?.abort();

    // 3) 终止在途执行（同步 abort 在途命令）
    this.runner?.stop();

    // 4) 提前复位会话标识（connection / runner），使新 connect 在隧道关闭期间
    //    不被 SESSION_EXISTS 拒绝。旧连接对象暂存于局部变量供后续清理。
    const conn = this.connection;
    this.connection = null;
    this.runner = null;
    this.fixer = null;
    this.manifest = null;
    this.clientProxy = undefined;

    // 5) 关闭隧道（TunnelManager 内部持有自己的 connection 引用，可安全异步关闭）。
    const tunnel = this.tunnel;
    this.tunnel = null;
    if (tunnel !== null) {
      await tunnel.close().catch(() => {});
    }

    // 6) 关闭旧 SSH 连接（tunnel 已注销 forward 后关闭，无需等待）。
    if (conn !== null) conn.close();
  }
}

// ---------------------------------------------------------------------------
//  Message handlers
// ---------------------------------------------------------------------------

/** connect：建连 + 清单装载 + 引擎装配 + 任务快照。 */
async function handleConnect(ctx: SessionContext, payload: Record<string, unknown>): Promise<void> {
  if (ctx.hasActiveSession()) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'SESSION_EXISTS', message: '已有活跃 SSH 会话，请先断开当前连接' },
    });
    return;
  }

  const host = typeof payload['host'] === 'string' ? payload['host'] : '';
  const username = typeof payload['username'] === 'string' ? payload['username'] : '';
  const port = typeof payload['port'] === 'number' ? payload['port'] : 22;
  const password = typeof payload['password'] === 'string' ? payload['password'] : '';
  if (host === '' || username === '') {
    ctx.broadcast({ type: 'error', payload: { message: 'connect 消息缺少 host/username' } });
    return;
  }

  ctx.broadcast({
    type: 'connection-status',
    payload: { state: 'connecting', message: `正在连接 ${username}@${host}:${port}…` },
  });

  // 清单装载先于建连：非法清单不建立 SSH 连接（保持未连接态）。
  const manifest = await ctx.resolveManifest(payload);
  if (manifest === null) return;

  // 客户端代理：payload.clientProxy 优先，兜底 config.json。
  const claimedProxy = typeof payload['clientProxy'] === 'string' ? payload['clientProxy'] : '';
  const proxy = claimedProxy.trim() !== '' ? claimedProxy : (await ctx.getDefaultClientProxy());

  const conn = ctx.createConnection({ host, port, username, password });
  ctx.setConnection(conn);
  try {
    await conn.connect();
  } catch (err) {
    const code = connectionErrorCode(conn);
    ctx.broadcast({
      type: 'connection-status',
      payload: {
        state: 'error',
        message: `${code}: ${conn.error?.message ?? (err as Error).message}`,
      },
    });
    ctx.closeConnection();
    return;
  }

  ctx.broadcast({
    type: 'connection-status',
    payload: { state: 'ready', message: `已连接 ${username}@${host}:${port}` },
  });

  ctx.initializeEngines(manifest, proxy);
  ctx.sendManifestSnapshot();
}

/**
 * exec：依赖闭包校验（BLOCKED_TASK 拦截）→ 过滤已 success 任务（兜底，
 * rerun 时纳入）→ 物化队列并启动 runner（rerun 时全量重置）。
 */
async function handleExec(ctx: SessionContext, payload: Record<string, unknown>): Promise<void> {
  const runner = ctx.runnerEngine;
  const manifest = ctx.currentManifest;
  if (!ctx.isReady() || runner === null || manifest === null) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 会话，无法执行任务' },
    });
    return;
  }

  const rawIds = Array.isArray(payload['taskIds']) ? payload['taskIds'] : [];
  const rerun = payload['rerun'] === true;
  const taskIds = rawIds.filter((id): id is string => typeof id === 'string');
  if (taskIds.length === 0) {
    ctx.broadcast({ type: 'error', payload: { message: 'exec 消息缺少任务列表（taskIds）' } });
    return;
  }

  const known = new Set(manifest.tasks.map((t) => t.id));
  for (const id of taskIds) {
    if (!known.has(id)) {
      ctx.broadcast({ type: 'error', payload: { message: `未知任务 id: ${id}` } });
      return;
    }
  }

  const states = runner.snapshotStates;

  // 依赖闭包校验：任务集中任一任务存在依赖未在本次队列 → 拦截（BLOCKED_TASK）。
  // 新语义（dependency-rerun-fix）：已 success 的依赖视为已满足，可不入队。
  const blocked = findBlockedTask(taskIds, manifest, states);
  if (blocked !== null) {
    ctx.broadcast({
      type: 'error',
      payload: {
        code: 'BLOCKED_TASK',
        message: `任务 ${blocked.taskId} 依赖 ${blocked.dep} 未在本次执行队列中，请先选择其依赖任务`,
      },
    });
    return;
  }

  // 兜底过滤（客户端行为不可信时的正确性保障）：非重跑时剔除已 success 任务。
  const queried = rerun ? taskIds : taskIds.filter((id) => states[id] !== 'success');
  if (queried.length === 0) {
    ctx.broadcast({
      type: 'error',
      payload: { message: '执行任务列表为空（所选任务均已成功；如需重跑请开启「全部重跑」）' },
    });
    return;
  }

  try {
    await runner.run(queried, rerun ? { reset: true } : undefined);
  } catch (err) {
    ctx.broadcast({ type: 'error', payload: { message: `执行启动失败: ${(err as Error).message}` } });
  }
}

/** stop：中止在途命令（stopped-state 事件负责状态/进度重放）。 */
function handleStop(ctx: SessionContext): void {
  const runner = ctx.runnerEngine;
  if (!ctx.isReady() || runner === null) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 会话' },
    });
    return;
  }
  runner.stop();
}

/** retry/skip：仅当任务处于 failed 且 runner 停在 awaiting-decision 时有效。 */
function handleRetry(ctx: SessionContext, payload: Record<string, unknown>): void {
  const runner = ctx.runnerEngine;
  const taskId = typeof payload['taskId'] === 'string' ? payload['taskId'] : '';
  if (!ctx.isReady() || runner === null) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 会话' },
    });
    return;
  }
  if (!isAwaitingFailed(runner, taskId)) {
    ctx.broadcast({
      type: 'error',
      payload: { message: `任务 ${taskId} 当前不可重试（仅待决策的失败任务可重试）` },
    });
    return;
  }
  runner.retry(taskId);
}

function handleSkip(ctx: SessionContext, payload: Record<string, unknown>): void {
  const runner = ctx.runnerEngine;
  const taskId = typeof payload['taskId'] === 'string' ? payload['taskId'] : '';
  if (!ctx.isReady() || runner === null) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 会话' },
    });
    return;
  }
  if (!isAwaitingFailed(runner, taskId)) {
    ctx.broadcast({
      type: 'error',
      payload: { message: `任务 ${taskId} 当前不可跳过（仅待决策的失败任务可跳过）` },
    });
    return;
  }
  runner.skip(taskId);
}

/** fixWithClaude：委托 Fixer.start；claude 不可用回可区分错误，任务保持 failed。 */
async function handleFixWithClaude(ctx: SessionContext, payload: Record<string, unknown>): Promise<void> {
  const runner = ctx.runnerEngine;
  const fixer = ctx.fixerEngine;
  const taskId = typeof payload['taskId'] === 'string' ? payload['taskId'] : '';
  if (!ctx.isReady() || runner === null || fixer === null) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 会话' },
    });
    return;
  }
  if (!isAwaitingFailed(runner, taskId)) {
    ctx.broadcast({
      type: 'error',
      payload: { message: `任务 ${taskId} 当前不可修复（须为待决策的失败任务）` },
    });
    return;
  }
  try {
    await fixer.start(taskId);
  } catch (err) {
    const message = (err as Error).message;
    const code = message.includes('服务器上 claude 不可用') ? 'CLAUDE_UNAVAILABLE' : undefined;
    ctx.broadcast({
      type: 'error',
      payload: code !== undefined ? { code, message } : { message },
    });
  }
}

/** pty-input：写入活跃修复会话 stdin（无会话回 NO_SESSION）。 */
function handlePtyInput(ctx: SessionContext, payload: Record<string, unknown>): void {
  const fixer = ctx.fixerEngine;
  const data = typeof payload['data'] === 'string' ? payload['data'] : undefined;
  if (fixer === null || !fixer.busy) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '当前无活跃修复会话' },
    });
    return;
  }
  if (data === undefined) {
    ctx.broadcast({ type: 'error', payload: { message: 'pty-input 消息缺少 data 字段' } });
    return;
  }
  try {
    fixer.write(data);
  } catch (err) {
    ctx.broadcast({ type: 'error', payload: { message: (err as Error).message } });
  }
}

/** tunnel-open：委托 TunnelManager.open；未连接/未配置代理回 error。 */
async function handleTunnelOpen(ctx: SessionContext): Promise<void> {
  const tunnel = ctx.tunnelEngine;
  if (!ctx.isReady()) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 连接，无法开启隧道' },
    });
    return;
  }
  if (tunnel === null) {
    ctx.broadcast({
      type: 'error',
      payload: { message: '未配置客户端代理，无法开启隧道' },
    });
    return;
  }
  try {
    const status = await tunnel.open();
    // open() 已触发 status 事件翻译；此处补发一次确保调用方即时可见最终态。
    ctx.broadcast({ type: 'tunnel-status', payload: toTunnelStatusPayload(status) });
  } catch (err) {
    const st = tunnel.getStatus();
    ctx.broadcast({
      type: 'tunnel-status',
      payload: { open: false, message: st.error ?? (err as Error).message },
    });
  }
}

/** tunnel-test：testConnectivity 结果经 tunnel-status 回传（出口 IP/失败原因）。 */
async function handleTunnelTest(ctx: SessionContext): Promise<void> {
  const tunnel = ctx.tunnelEngine;
  if (!ctx.isReady()) {
    ctx.broadcast({
      type: 'error',
      payload: { code: 'NO_SESSION', message: '尚未建立 SSH 连接，无法测试隧道' },
    });
    return;
  }
  if (tunnel === null) {
    ctx.broadcast({ type: 'error', payload: { message: '未配置客户端代理，无法测试隧道' } });
    return;
  }
  const result = await tunnel.testConnectivity();
  if (result.ok) {
    ctx.broadcast({
      type: 'tunnel-status',
      payload: {
        open: true,
        remotePort: tunnel.remotePort,
        message: `出口 IP: ${result.ip}`,
      },
    });
  } else {
    ctx.broadcast({
      type: 'tunnel-status',
      payload: {
        open: tunnel.state === 'open',
        message: `连通性测试失败: ${result.error}`,
      },
    });
  }
}

/** disconnect：全量清理并回 connection-status (disconnected)；无会话时幂等。 */
async function handleDisconnect(ctx: SessionContext): Promise<void> {
  await ctx.teardown();
  ctx.broadcast({ type: 'connection-status', payload: { state: 'disconnected', message: '已断开连接' } });
}

/** snapshot：全量状态补发（无会话回空态快照，不回 error）。 */
function handleSnapshot(ctx: SessionContext): void {
  ctx.sendFullSnapshot();
}

// ---------------------------------------------------------------------------
//  Assembly
// ---------------------------------------------------------------------------

/**
 * 装配入口：把 11 种 ClientMessage 全部注册到 router，返回共享的
 * SessionContext（单会话语义）。每次消息派发时绑定当前 socket，使
 * broadcast 与 ws close 兜底清理正确工作。
 */
export function registerSessionHandlers(router: MessageRouter, deps: SessionDeps): SessionContext {
  const ctx = new SessionContext(deps);
  const attach = (socket: SessionChannel): void => ctx.attachSocket(socket);

  router.register('connect', (payload, _send, socket) => {
    attach(socket);
    return handleConnect(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('exec', (payload, _send, socket) => {
    attach(socket);
    return handleExec(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('stop', (_payload, _send, socket) => {
    attach(socket);
    handleStop(ctx);
  });
  router.register('retry', (payload, _send, socket) => {
    attach(socket);
    handleRetry(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('skip', (payload, _send, socket) => {
    attach(socket);
    handleSkip(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('fixWithClaude', (payload, _send, socket) => {
    attach(socket);
    return handleFixWithClaude(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('pty-input', (payload, _send, socket) => {
    attach(socket);
    handlePtyInput(ctx, (payload ?? {}) as Record<string, unknown>);
  });
  router.register('tunnel-open', (_payload, _send, socket) => {
    attach(socket);
    return handleTunnelOpen(ctx);
  });
  router.register('tunnel-test', (_payload, _send, socket) => {
    attach(socket);
    return handleTunnelTest(ctx);
  });
  router.register('disconnect', (_payload, _send, socket) => {
    attach(socket);
    return handleDisconnect(ctx);
  });
  router.register('snapshot', (_payload, _send, socket) => {
    attach(socket);
    handleSnapshot(ctx);
  });

  return ctx;
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** 把 SshConnection 的错误类别映射为可区分错误码（AUTH_FAILED/UNREACHABLE/TIMEOUT）。 */
function connectionErrorCode(conn: SshConnectionLike): string {
  return conn.errorCategory ?? 'UNREACHABLE';
}

/**
 * exec 依赖闭包校验：返回首个「依赖未在本次队列」的任务（否则 null）。
 * 新语义（dependency-rerun-fix）：已 success 的依赖视为已满足，允许不入队
 * （前端级联会过滤 success 依赖，此处与服务端兜底过滤保持同一判定）。
 */
function findBlockedTask(
  taskIds: readonly string[],
  manifest: TaskManifest,
  states: Readonly<Record<string, RunnerTaskStatus>>,
): { taskId: string; dep: string } | null {
  const selected = new Set(taskIds);
  for (const task of manifest.tasks) {
    if (!selected.has(task.id)) continue;
    for (const dep of task.requires) {
      if (!selected.has(dep) && states[dep] !== 'success') return { taskId: task.id, dep };
    }
  }
  return null;
}

/** 任务是否处于「待决策的失败态」（runner 停在 awaitingDecision 且状态 failed）。 */
function isAwaitingFailed(runner: RunnerLike, taskId: string): boolean {
  const snap = runner.snapshot();
  return snap.awaitingDecision === taskId && snap.states[taskId] === 'failed';
}

/** TunnelStatus → tunnel-status ServerMessage（open 语义 + 可读 message）。 */
function toTunnelStatusPayload(status: TunnelStatus | null): TunnelStatusPayload {
  if (status === null || status.state === 'closed') return { open: false };
  if (status.state === 'open') {
    return { open: true, remotePort: status.remotePort };
  }
  if (status.state === 'opening') {
    return { open: false, message: '隧道开启中' };
  }
  return { open: false, message: status.error ?? '隧道不可用' };
}
