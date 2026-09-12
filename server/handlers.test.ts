/**
 * server/handlers.test.ts
 *
 * WebSocket session handler 单元测试 —— fake 引擎注入，覆盖 add-ws-handlers
 * spec 全部场景。
 *
 * 方法：真实 MessageRouter + registerSessionHandlers 装配，注入：
 *   - fake SshConnection（createConnection）
 *   - fake runner/fixer/tunnel（engineFactory）
 *   - fake SessionChannel（收集 broadcast 序列 + 可触发 close）
 * 以 router.dispatch 喂消息，断言广播序列（消息 → 行为 → send）。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { MessageRouter } from './ws.js';
import {
  registerSessionHandlers,
  type SessionContext,
  type SessionDeps,
  type SessionChannel,
  type RunnerLike,
  type FixerLike,
  type TunnelLike,
  type SshConnectionLike,
} from './handlers.js';
import type { TaskManifest } from '../shared/schema.js';
import type { ServerMessage } from '../shared/messages.js';
import type { TunnelStatus, ConnectivityResult } from './ssh/tunnel.js';
import type { RunnerSnapshot, TaskStatus as RunnerTaskStatus } from './engine/runner.js';

// ---------------------------------------------------------------------------
//  Fake 引擎
// ---------------------------------------------------------------------------

export class FakeConnection implements SshConnectionLike {
  state: 'connecting' | 'ready' | 'closed' | 'error' = 'connecting';
  errorCategory: string | undefined;
  error: Error | undefined;
  /** 测试注入：connect() 的行为。 */
  connectBehavior: 'ok' | 'auth-failed' | 'unreachable' | 'timeout' | 'hang' = 'ok';
  closeCalls = 0;

  constructor(public readonly config: { host: string; port: number; username: string; password: string }) {}

  async connect(): Promise<void> {
    switch (this.connectBehavior) {
      case 'auth-failed':
        this.errorCategory = 'AUTH_FAILED';
        this.error = new Error('All configured authentication methods failed');
        this.state = 'error';
        throw this.error;
      case 'unreachable':
        this.errorCategory = 'UNREACHABLE';
        this.error = new Error('connect ECONNREFUSED 127.0.0.1:2222');
        this.state = 'error';
        throw this.error;
      case 'timeout':
        this.errorCategory = 'TIMEOUT';
        this.error = new Error('SSH connection timed out');
        this.state = 'error';
        throw this.error;
      case 'hang':
        // 永不 resolve（测试 socket close 竞态时用）
        return new Promise(() => {});
      default:
        this.state = 'ready';
    }
  }

  close(): void {
    this.closeCalls += 1;
    if (this.state !== 'error') this.state = 'closed';
  }
}

/** 可编程 fake runner：行为由测试注入，事件逐个 emit。 */
export class FakeRunner extends EventEmitter implements RunnerLike {
  /** run() 调用记录：taskIds + reset 选项（dependency-rerun-fix）。 */
  runCalls: Array<{ taskIds: string[]; reset?: boolean }> = [];
  stopCalls = 0;
  retryCalls: string[] = [];
  skipCalls: string[] = [];

  /** run() 时按序 emit 的事件脚本。 */
  runScript: Array<() => void> = [];
  /** 若设置，传入非「待决策失败」校验的任务会被记录（供非法调用断言）。 */
  invalidRetry: string[] = [];

  states: Record<string, RunnerTaskStatus> = {};

  get snapshotStates(): Readonly<Record<string, RunnerTaskStatus>> {
    return this.states;
  }

  async run(taskIds: string[], options?: { reset?: boolean }): Promise<void> {
    this.runCalls.push({ taskIds: [...taskIds], reset: options?.reset });
    for (const step of this.runScript) step();
    this.emit('progress', this.completed, this.total);
    this.emit('queue-finished', { reason: 'completed' });
  }

  /** 已完成（success/skipped）任务计数。 */
  get completed(): number {
    return Object.values(this.states).filter((s) => s === 'success' || s === 'skipped').length;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  retry(taskId: string): void {
    if (!this.isAwaitingFailed(taskId)) {
      this.invalidRetry.push(taskId);
      return;
    }
    this.retryCalls.push(taskId);
    this.awaiting = null; // 决策已消费（真实 runner 推进状态机）
  }

  skip(taskId: string): void {
    if (!this.isAwaitingFailed(taskId)) {
      this.invalidRetry.push(taskId);
      return;
    }
    this.skipCalls.push(taskId);
    this.awaiting = null;
    this.states[taskId] = 'skipped';
  }

  snapshot(): RunnerSnapshot {
    return {
      states: { ...this.states },
      queue: [],
      currentTask: null,
      awaitingDecision: this.awaiting,
      running: this.running,
      total: this.total,
      completed: this.completed,
    };
  }

  // -- 测试辅助 -------------------------------------------------------------

  awaiting: string | null = null;
  running = false;
  total = 0;

  setState(id: string, status: RunnerTaskStatus): void {
    this.states[id] = status;
  }

  /** 把任务置为待决策失败态（供 retry/skip/fix 场景）。 */
  parkFailed(id: string): void {
    this.awaiting = id;
    this.states[id] = 'failed';
  }

  private isAwaitingFailed(id: string): boolean {
    return this.awaiting === id && this.states[id] === 'failed';
  }
}

export class FakeFixer extends EventEmitter implements FixerLike {
  busy = false;
  startCalls: string[] = [];
  writeCalls: string[] = [];
  /** 抛错的消息（start 时）。 */
  startError: Error | null = null;

  async start(taskId: string): Promise<void> {
    if (this.startError) throw this.startError;
    this.startCalls.push(taskId);
    this.busy = true;
  }

  write(data: string): void {
    this.writeCalls.push(data);
  }

  abort(): void {
    this.busy = false;
  }
}

export class FakeTunnel extends EventEmitter implements TunnelLike {
  state: 'closed' | 'opening' | 'open' | 'error' = 'closed';
  remotePort: number | undefined;
  openCalls = 0;
  testCalls = 0;
  openResult: TunnelStatus | null = null;
  testResult: ConnectivityResult = { ok: false, error: '隧道未开启' };

  async open(): Promise<TunnelStatus> {
    this.openCalls += 1;
    if (this.openResult !== null) {
      this.set({ ...this.openResult });
      return this.openResult;
    }
    this.set({ state: 'open', remotePort: 31234 });
    return this.getStatus();
  }

  async close(): Promise<void> {
    this.set({ state: 'closed' });
  }

  async testConnectivity(): Promise<ConnectivityResult> {
    this.testCalls += 1;
    return this.testResult;
  }

  getStatus(): TunnelStatus {
    return { state: this.state, remotePort: this.remotePort };
  }

  /** 测试辅助：更新状态并发射 status 事件（engine 主动推送验证）。 */
  set(status: TunnelStatus): void {
    this.state = status.state;
    this.remotePort = status.remotePort;
    this.emit('status', { ...status });
  }
}

// ---------------------------------------------------------------------------
//  Fake 通道与装配
// ---------------------------------------------------------------------------

/** 会话通道 fake：收集 broadcast 消息、可模拟 close（readyState 检查验证）。 */
export class FakeChannel implements SessionChannel {
  readyState = 1; // WebSocket.OPEN
  sent: ServerMessage[] = [];
  private closeListeners: Array<() => void> = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  once(event: 'close', listener: () => void): this {
    if (event === 'close') this.closeListeners.push(listener);
    return this;
  }

  removeListener(event: 'close', listener: () => void): this {
    if (event === 'close') {
      this.closeListeners = this.closeListeners.filter((l) => l !== listener);
    }
    return this;
  }

  /** 模拟 WebSocket 断开（任务 2.4 兜底清理验证）。 */
  emitClose(): void {
    this.readyState = 3; // WebSocket.CLOSED
    for (const listener of [...this.closeListeners]) listener();
  }

  // -- 查询辅助 -------------------------------------------------------------
  ofType(type: ServerMessage['type']): ServerMessage[] {
    return this.sent.filter((m) => m.type === type);
  }

  errors(): ServerMessage[] {
    return this.sent.filter((m) => m.type === 'error');
  }

  last(): ServerMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

function makeManifest(tasks: TaskManifest['tasks']): TaskManifest {
  return { meta: { name: 'unit', version: '1' }, tasks };
}

const CUSTOM_YAML = `meta:
  name: custom
  version: "1"
tasks:
  - id: only
    title: Only
    commands:
      - echo only
`;

const INVALID_YAML = `meta:
  name: broken
  version: "1"
tasks:
  - title: 缺少 id 字段
    commands:
      - echo x
`;

interface Harness {
  router: MessageRouter;
  ctx: SessionContext;
  channel: FakeChannel;
  conn: FakeConnection;
  runner: FakeRunner;
  fixer: FakeFixer;
  tunnel: FakeTunnel;
  deps: SessionDeps;
}

/** 装配完整 harness：默认 connect 成功（内置清单 + 无 proxy）。 */
function makeHarness(opts: {
  connectBehavior?: FakeConnection['connectBehavior'];
  clientProxy?: string;
  configClientProxy?: string;
} = {}): Harness {
  const router = new MessageRouter();
  const conn = new FakeConnection({ host: 'h', port: 22, username: 'u', password: 'p' });
  conn.connectBehavior = opts.connectBehavior ?? 'ok';
  const runner = new FakeRunner();
  const fixer = new FakeFixer();
  const tunnel = new FakeTunnel();

  const deps: SessionDeps = {
    config: {
      async get() {
        return {
          servers: [],
          clientProxy: opts.configClientProxy ?? undefined,
        };
      },
    },
    builtinManifestPath: builtinPath || '/unused/builtin.yaml',
    createConnection: () => conn,
    // 隧道按 clientProxy 是否存在决定装配（与真实行为一致）。
    engineFactory: (_ctx, _c, _m, proxy) => ({
      runner,
      fixer,
      tunnel: proxy !== undefined && proxy !== '' ? tunnel : null,
    }),
  };

  // 单例变量显式声明（避免 il8n 提示）：此处无多余。
  const ctx = registerSessionHandlers(router, deps);
  return { router, ctx, channel: new FakeChannel(), conn, runner, fixer, tunnel, deps };
}

/** dispatch 一个消息并等待 handler 完成（socket 以 fake 通道替代）。 */
async function dispatch(h: Harness, raw: string): Promise<void> {
  await h.router.dispatch(raw, () => {}, h.channel as unknown as WebSocket);
}

function connectMsg(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'connect',
    payload: {
      host: '127.0.0.1',
      port: 2222,
      username: 'root',
      password: 'pw',
      ...overrides,
    },
  });
}

/** 标准 connect 成功序列断言辅助。 */
function expectConnected(h: Harness): void {
  expect(h.ctx.isReady()).toBe(true);
  const statuses = h.channel.ofType('connection-status');
  expect(statuses[0]?.type === 'connection-status' ? (statuses[0] as { payload: { state: string } }).payload.state : '').toBe('connecting');
  expect((statuses[1] as { payload: { state: string } })?.payload.state ?? '').toBe('ready');
}

// ---------------------------------------------------------------------------
//  临时内置清单
// ---------------------------------------------------------------------------

let builtinPath = '';

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fenix-handlers-'));
  builtinPath = join(dir, 'tasks.yaml');
  await writeFile(
    builtinPath,
    `meta:\n  name: builtin\n  version: "1"\ntasks:\n  - id: alpha\n    title: Alpha\n    commands:\n      - echo alpha\n  - id: beta\n    title: Beta\n    commands:\n      - echo beta\n    requires:\n      - alpha\n`,
    'utf8',
  );
});

afterAll(async () => {
  if (builtinPath) await rm(join(builtinPath, '..'), { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
//  2. connect/disconnect
// ---------------------------------------------------------------------------

describe('connect', () => {
  it('正确凭据 → connecting + ready + 任务快照（全量 pending + progress 0/N）', async () => {
    const h = makeHarness({ builtinYaml: '' });
    await dispatch(h, connectMsg());

    expectConnected(h);
    const states = h.channel.ofType('task-state');
    const ids = states.map((m) => (m as { payload: { taskId: string } }).payload.taskId);
    expect(ids).toEqual(['alpha', 'beta']);
    for (const s of states) {
      expect((s as { payload: { status: string } }).payload.status).toBe('pending');
    }
    expect(h.channel.ofType('progress')).toEqual([
      { type: 'progress', payload: { completed: 0, total: 2 } },
    ]);
    expect(h.ctx.hasActiveSession()).toBe(true);
  });

  it('connect 成功 → 消息序列为 connection-status(connecting/ready) → manifest → task-state×N → progress', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());

    const kinds = h.channel.sent.map((m) => m.type);
    // 头部：connecting + ready 两次连接状态；随后 manifest 先于全部 task-state。
    expect(kinds.slice(0, 2)).toEqual(['connection-status', 'connection-status']);
    const manifestIdx = kinds.indexOf('manifest');
    const firstStateIdx = kinds.findIndex((k) => k === 'task-state');
    const progressIdx = kinds.lastIndexOf('progress');
    expect(manifestIdx).toBe(2);
    expect(manifestIdx).toBeLessThan(firstStateIdx);
    expect(firstStateIdx).toBeLessThan(progressIdx);
    // manifest 携带当前会话清单（内置临时文件 alpha/beta）。
    const manifestMsg = h.channel.sent[manifestIdx] as { payload: { manifest: { tasks: Array<{ id: string }> } } };
    expect(manifestMsg.payload.manifest.tasks.map((t) => t.id)).toEqual(['alpha', 'beta']);
    // task-state 数量与清单任务数一致，且全部在 progress 之前到达。
    const stateCount = kinds.filter((k) => k === 'task-state').length;
    expect(stateCount).toBe(2);
    expect(kinds.slice(firstStateIdx, progressIdx).filter((k) => k === 'progress').length).toBe(0);
  });

  it('认证失败 → connection-status (error) 含 AUTH_FAILED', async () => {
    const h = makeHarness({ connectBehavior: 'auth-failed' });
    await dispatch(h, connectMsg());
    const status = h.channel.ofType('connection-status').at(-1) as {
      payload: { state: string; message: string };
    };
    expect(status.payload.state).toBe('error');
    expect(status.payload.message).toContain('AUTH_FAILED');
    expect(h.ctx.hasActiveSession()).toBe(false);
  });

  it('网络不可达 → AUTH 前缀错误', async () => {
    const h = makeHarness({ connectBehavior: 'unreachable' });
    await dispatch(h, connectMsg());
    const status = h.channel.ofType('connection-status').at(-1) as { payload: { state: string; message: string } };
    expect(status.payload.state).toBe('error');
    expect(status.payload.message).toContain('UNREACHABLE');
  });

  it('连接超时 → TIMEOUT 前缀错误', async () => {
    const h = makeHarness({ connectBehavior: 'timeout' });
    await dispatch(h, connectMsg());
    const status = h.channel.ofType('connection-status').at(-1) as { payload: { state: string; message: string } };
    expect(status.payload.state).toBe('error');
    expect(status.payload.message).toContain('TIMEOUT');
  });

  it('已有活跃会话时重复 connect → SESSION_EXISTS，既有连接不受影响', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);

    await dispatch(h, connectMsg());
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('SESSION_EXISTS');
    // 既有连接仍就绪
    expect(h.ctx.isReady()).toBe(true);
    expect(h.conn.closeCalls).toBe(0);
  });

  it('携带合法自定义清单 → 以该清单建立 runner 上下文', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ manifestYaml: CUSTOM_YAML }));
    expectConnected(h);
    const ids = h.channel.ofType('task-state').map((m) => (m as { payload: { taskId: string } }).payload.taskId);
    expect(ids).toEqual(['only']);
    expect(h.channel.ofType('progress')).toEqual([
      { type: 'progress', payload: { completed: 0, total: 1 } },
    ]);
  });

  it('携带非法清单 → MANIFEST_INVALID（含首个校验错误路径），不建立连接', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ manifestYaml: INVALID_YAML }));
    const err = h.channel.errors().at(-1) as { payload: { code: string; message: string } };
    expect(err.payload.code).toBe('MANIFEST_INVALID');
    expect(err.payload.message).toContain('tasks.0');
    expect(h.ctx.hasActiveSession()).toBe(false);
  });

  it('未携带清单 → 加载内置清单', async () => {
    const h = makeHarness();
    h.deps.builtinManifestPath = builtinPath;
    await dispatch(h, connectMsg());
    expectConnected(h);
    const ids = h.channel.ofType('task-state').map((m) => (m as { payload: { taskId: string } }).payload.taskId);
    // 内置临时文件（meta.name = builtin）的任务集被装载。
    expect(ids).toEqual(['alpha', 'beta']);
  });
});

describe('disconnect', () => {
  it('断开 → 清理全部资源 + connection-status (disconnected)，再次 connect 可重建', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);
    h.runner.stopCalls = 0;

    await dispatch(h, JSON.stringify({ type: 'disconnect' }));

    const status = h.channel.ofType('connection-status').at(-1) as { payload: { state: string } };
    expect(status.payload.state).toBe('disconnected');
    expect(h.runner.stopCalls).toBe(1);
    expect(h.conn.closeCalls).toBe(1);
    expect(h.fixer.busy).toBe(false);
    expect(h.ctx.isReady()).toBe(false);

    // 再次 connect 可正常建立新会话
    await dispatch(h, connectMsg());
    expectConnected(h);
  });

  it('无会话时断开幂等（不回 error）', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'disconnect' }));
    const errors = h.channel.errors();
    expect(errors.length).toBe(0);
    const status = h.channel.ofType('connection-status').at(-1) as { payload: { state: string } };
    expect(status.payload.state).toBe('disconnected');
  });

  it('WebSocket 断开 → 触发与 disconnect 相同的清理路径', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);

    h.channel.emitClose();
    // teardown 为异步清理：等待 conn.close() 执行。
    await vi.waitFor(() => expect(h.conn.closeCalls).toBe(1));
    await vi.waitFor(() => expect(h.runner.stopCalls).toBe(1));
    expect(h.ctx.isReady()).toBe(false);
  });

  it('socket 未打开时 broadcast 被忽略（readyState 检查）', async () => {
    const h = makeHarness();
    h.channel.readyState = 3; // 模拟已关闭
    await dispatch(h, connectMsg());
    expect(h.channel.sent.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
//  3. exec / stop / retry / skip
// ---------------------------------------------------------------------------

describe('exec', () => {
  it('无会话 → NO_SESSION', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['alpha'] } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('NO_SESSION');
  });

  it('依赖未在队列 → BLOCKED_TASK，不启动执行', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);

    // beta 依赖 alpha，但队列只含 beta → 拦截
    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['beta'] } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string; message: string } };
    expect(err.payload.code).toBe('BLOCKED_TASK');
    expect(err.payload.message).toContain('beta');
    expect(h.runner.runCalls.length).toBe(0);
  });

  it('依赖闭包合法 → 启动 runner；task-state/log/progress 实时广播', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);
    h.channel.sent = [];

    h.runner.setState('alpha', 'running');
    h.runner.runScript = [
      () => h.runner.emit('task-state', 'alpha', 'running'),
      () => h.runner.emit('log', { taskId: 'alpha', stream: 'stdout', data: 'hello\n' }),
      () => h.runner.setState('alpha', 'success'),
      () => h.runner.emit('task-state', 'alpha', 'success'),
    ];
    h.runner.total = 1;

    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['alpha'] } }));

    expect(h.runner.runCalls[0]?.taskIds).toEqual(['alpha']);
    expect(h.runner.runCalls[0]?.reset).toBeUndefined();
    const logs = h.channel.ofType('log') as Array<{ payload: { taskId: string; stream: string; data: string } }>;
    expect(logs[0]?.payload.taskId).toBe('alpha');
    expect(logs[0]?.payload.stream).toBe('stdout');
    const taskStates = h.channel.ofType('task-state') as Array<{ payload: { taskId: string; status: string } }>;
    expect(taskStates.map((s) => s.payload)).toEqual([
      { taskId: 'alpha', status: 'running' },
      { taskId: 'alpha', status: 'success' },
    ]);
    // 队列结束补发最终进度
    expect(h.channel.ofType('progress').at(-1)).toEqual({
      type: 'progress',
      payload: { completed: 1, total: 1 },
    });
  });

  it('stop → runner.stop 被调用；stopped-state 重放为 task-state + progress', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    expectConnected(h);
    h.channel.sent = [];

    // 先进入运行中：模拟 stopped-state 事件
    h.fixer.busy = true;
    h.runner.setState('alpha', 'running');
    h.runner.emit('stopped-state', {
      states: { alpha: 'failed', beta: 'pending' },
      queue: ['alpha', 'beta'],
      currentTask: 'alpha',
      awaitingDecision: null,
      running: true,
      total: 2,
      completed: 0,
    });

    await dispatch(h, JSON.stringify({ type: 'stop' }));

    expect(h.runner.stopCalls).toBe(1);
    const states = h.channel.ofType('task-state') as Array<{ payload: { taskId: string; status: string } }>;
    expect(states[0]?.payload).toEqual({ taskId: 'alpha', status: 'failed' });
    expect(states[1]?.payload).toEqual({ taskId: 'beta', status: 'pending' });
    expect(h.channel.ofType('progress').at(-1)).toEqual({
      type: 'progress',
      payload: { completed: 0, total: 2 },
    });
  });

  it('未知任务 id → error 不启动', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['nope'] } }));
    const err = h.channel.errors().at(-1) as { payload: { message: string } };
    expect(err.payload.message).toContain('nope');
    expect(h.runner.runCalls.length).toBe(0);
  });

  it('已 success 任务非重跑不入队：执行依赖它的下游任务 → 仅下游入队（兜底过滤）', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');
    h.channel.sent = [];

    // beta 依赖 alpha，alpha 已 success → 闭包校验放行，runner 仅收到 beta。
    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['beta'] } }));
    expect(h.channel.errors().length).toBe(0);
    expect(h.runner.runCalls).toEqual([{ taskIds: ['beta'], reset: undefined }]);
  });

  it('已 success 任务直接执行（非重跑）→ 过滤后为空，回可区分错误不启动', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');

    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['alpha'] } }));
    const err = h.channel.errors().at(-1) as { payload: { message: string } };
    expect(err.payload.message).toContain('全部重跑');
    expect(h.runner.runCalls.length).toBe(0);
  });

  it('rerun: true → 纳入已 success 任务并带 reset 选项启动 runner', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');

    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['alpha', 'beta'], rerun: true } }));
    expect(h.channel.errors().length).toBe(0);
    expect(h.runner.runCalls).toEqual([
      { taskIds: ['alpha', 'beta'], reset: true },
    ]);
  });

  it('rerun: true 且依赖已 success → 闭包校验仍放行（全量重跑语义）', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');

    // 只勾选 beta 但开重跑：alpha 虽不入 taskIds，闭包校验按 success 放行；
    // runner 收到 [beta] 与 reset（runner 自身按闭包补全 alpha）。
    await dispatch(h, JSON.stringify({ type: 'exec', payload: { taskIds: ['beta'], rerun: true } }));
    expect(h.channel.errors().length).toBe(0);
    expect(h.runner.runCalls).toEqual([{ taskIds: ['beta'], reset: true }]);
  });
});

describe('retry / skip', () => {
  it('无会话 → NO_SESSION', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'retry', payload: { taskId: 'alpha' } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('NO_SESSION');
  });

  it('非待决策失败态 → 回 error，不重试', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');
    await dispatch(h, JSON.stringify({ type: 'retry', payload: { taskId: 'alpha' } }));
    const err = h.channel.errors().at(-1) as { payload: { message: string } };
    expect(err.payload.message).toContain('不可重试');
    expect(h.runner.retryCalls.length).toBe(0);
  });

  it('待决策失败态 retry → runner.retry 被调用；重跑事件继续广播', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.parkFailed('alpha');
    h.runner.runScript = [
      () => h.runner.emit('task-state', 'alpha', 'running'),
      () => h.runner.setState('alpha', 'success'),
      () => h.runner.emit('task-state', 'alpha', 'success'),
    ];
    await dispatch(h, JSON.stringify({ type: 'retry', payload: { taskId: 'alpha' } }));
    expect(h.runner.retryCalls).toEqual(['alpha']);
    // retry 不改队列（runner 自行重跑），无 error
    expect(h.channel.errors().length).toBe(0);
  });

  it('skip → 仅待决策失败态有效；成功跳过', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.parkFailed('alpha');
    await dispatch(h, JSON.stringify({ type: 'skip', payload: { taskId: 'alpha' } }));
    expect(h.runner.skipCalls).toEqual(['alpha']);
    expect(h.channel.errors().length).toBe(0);

    // 非停等任务再次 skip → error
    await dispatch(h, JSON.stringify({ type: 'skip', payload: { taskId: 'alpha' } }));
    expect(h.channel.errors().length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
//  4. fixWithClaude / pty-input
// ---------------------------------------------------------------------------

describe('fixWithClaude', () => {
  it('失败任务触发 → fixer.start 被调用；claude-output 实时转发', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.parkFailed('alpha');

    const startPromise = dispatch(h, JSON.stringify({ type: 'fixWithClaude', payload: { taskId: 'alpha' } }));
    // fixer.start 已同步置 busy 前，先发一个输出（模拟处理中）
    h.fixer.emit('claude-output', 'Applying fixes...\n');
    await startPromise;

    expect(h.fixer.startCalls).toEqual(['alpha']);
    const outputs = h.channel.ofType('claude-output') as Array<{ payload: { data: string } }>;
    expect(outputs.map((o) => o.payload.data)).toContain('Applying fixes...\n');
  });

  it('任务非 failed → 回 error 不修复', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');
    await dispatch(h, JSON.stringify({ type: 'fixWithClaude', payload: { taskId: 'alpha' } }));
    const err = h.channel.errors().at(-1) as { payload: { message: string } };
    expect(err.payload.message).toContain('不可修复');
    expect(h.fixer.startCalls.length).toBe(0);
  });

  it('claude 不可用 → CLAUDE_UNAVAILABLE 可区分错误，任务保持 failed', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.parkFailed('alpha');
    h.fixer.startError = new Error('服务器上 claude 不可用，请先执行 Claude Code 安装任务');

    await dispatch(h, JSON.stringify({ type: 'fixWithClaude', payload: { taskId: 'alpha' } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string; message: string } };
    expect(err.payload.code).toBe('CLAUDE_UNAVAILABLE');
    expect(err.payload.message).toContain('claude 不可用');
    // 任务状态未被 fixer 改动（保持 failed）
    expect(h.runner.snapshotStates['alpha']).toBe('failed');
  });

  it('无会话 → NO_SESSION', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'fixWithClaude', payload: { taskId: 'alpha' } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('NO_SESSION');
  });
});

describe('pty-input', () => {
  it('无修复会话 → NO_SESSION', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    await dispatch(h, JSON.stringify({ type: 'pty-input', payload: { data: 'x' } }));
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('NO_SESSION');
  });

  it('活跃修复会话 → fixer.write 转发', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.fixer.busy = true;
    await dispatch(h, JSON.stringify({ type: 'pty-input', payload: { data: 'yes\n' } }));
    expect(h.fixer.writeCalls).toEqual(['yes\n']);
    expect(h.channel.errors().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
//  4. tunnel-open / tunnel-test
// ---------------------------------------------------------------------------

describe('tunnel', () => {
  it('未连接时 tunnel-open → NO_SESSION', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'tunnel-open' }));
    const err = h.channel.errors().at(-1) as { payload: { code: string } };
    expect(err.payload.code).toBe('NO_SESSION');
  });

  it('已连接但未配置代理 → error（clientProxy 缺省）', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    await dispatch(h, JSON.stringify({ type: 'tunnel-open' }));
    const err = h.channel.errors().at(-1) as { payload: { message: string } };
    expect(err.payload.message).toContain('客户端代理');
  });

  it('tunnel-open 成功 → tunnel.open 调用 + tunnel-status (open=true) 推送', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ clientProxy: '127.0.0.1:7890' }));
    h.tunnel.openResult = { state: 'open', remotePort: 31234 };
    h.channel.sent = [];

    await dispatch(h, JSON.stringify({ type: 'tunnel-open' }));
    expect(h.tunnel.openCalls).toBe(1);
    const status = h.channel.ofType('tunnel-status').at(-1) as { payload: { open: boolean; remotePort?: number } };
    expect(status.payload).toMatchObject({ open: true, remotePort: 31234 });
  });

  it('tunnel 状态事件主动推送为 tunnel-status', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ clientProxy: '127.0.0.1:7890' }));
    h.channel.sent = [];
    // 引擎主动推送（例如 SSH 断线 → error 状态）
    h.tunnel.set({ state: 'error', error: 'SSH 连接已断开，隧道失效' });
    const status = h.channel.ofType('tunnel-status').at(-1) as { payload: { open: boolean; message?: string } };
    expect(status.payload).toMatchObject({ open: false, message: 'SSH 连接已断开，隧道失效' });
  });

  it('tunnel-test 成功 → tunnel-status 含出口 IP', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ clientProxy: '127.0.0.1:7890' }));
    h.tunnel.set({ state: 'open', remotePort: 31234 });
    h.tunnel.testResult = { ok: true, ip: '1.2.3.4' };
    h.channel.sent = [];

    await dispatch(h, JSON.stringify({ type: 'tunnel-test' }));
    expect(h.tunnel.testCalls).toBe(1);
    const status = h.channel.ofType('tunnel-status').at(-1) as { payload: { open: boolean; message?: string } };
    expect(status.payload).toMatchObject({ open: true, message: '出口 IP: 1.2.3.4' });
  });

  it('tunnel-test 失败 → tunnel-status 含失败原因', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg({ clientProxy: '127.0.0.1:7890' }));
    h.tunnel.set({ state: 'open', remotePort: 31234 });
    h.tunnel.testResult = { ok: false, error: 'curl 退出码 7' };
    h.channel.sent = [];

    await dispatch(h, JSON.stringify({ type: 'tunnel-test' }));
    const status = h.channel.ofType('tunnel-status').at(-1) as { payload: { open: boolean; message?: string } };
    expect(status.payload).toMatchObject({ open: true, message: '连通性测试失败: curl 退出码 7' });
  });
});

// ---------------------------------------------------------------------------
//  snapshot
// ---------------------------------------------------------------------------

describe('snapshot', () => {
  it('无会话 → 空态快照（progress 0/0 + tunnel open=false），不回 error', async () => {
    const h = makeHarness();
    await dispatch(h, JSON.stringify({ type: 'snapshot' }));
    expect(h.channel.ofType('progress')).toEqual([
      { type: 'progress', payload: { completed: 0, total: 0 } },
    ]);
    expect(h.channel.ofType('tunnel-status')).toEqual([
      { type: 'tunnel-status', payload: { open: false } },
    ]);
    expect(h.channel.errors().length).toBe(0);
  });

  it('有会话 → 全量 task-state + progress + tunnel-status，且 manifest 先于状态补发', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.runner.setState('alpha', 'success');
    h.runner.setState('beta', 'pending');
    h.runner.total = 2;
    h.channel.sent = [];

    await dispatch(h, JSON.stringify({ type: 'snapshot' }));

    // 重连补发：manifest 先于全部 task-state（design 决策 2）。
    expect(h.channel.sent[0]?.type).toBe('manifest');
    const manifestMsg = h.channel.sent[0] as { payload: { manifest: { tasks: Array<{ id: string }> } } };
    expect(manifestMsg.payload.manifest.tasks.map((t) => t.id)).toEqual(['alpha', 'beta']);

    const states = h.channel.ofType('task-state') as Array<{ payload: { taskId: string; status: string } }>;
    expect(states.map((s) => s.payload)).toEqual([
      { taskId: 'alpha', status: 'success' },
      { taskId: 'beta', status: 'pending' },
    ]);
    expect(h.channel.ofType('progress')).toEqual([
      { type: 'progress', payload: { completed: 1, total: 2 } },
    ]);
    expect(h.channel.ofType('tunnel-status')[0]).toEqual({
      type: 'tunnel-status',
      payload: { open: false },
    });
  });

  it('有会话未 run 过 → progress 以清单全量为分母', async () => {
    const h = makeHarness();
    await dispatch(h, connectMsg());
    h.channel.sent = [];
    await dispatch(h, JSON.stringify({ type: 'snapshot' }));
    expect(h.channel.ofType('progress')).toEqual([
      { type: 'progress', payload: { completed: 0, total: 2 } },
    ]);
  });
});