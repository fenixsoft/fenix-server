/**
 * tests/e2e/exec-flow.test.ts
 *
 * 执行链路端到端测试（add-manifest-delivery SPEC：manifest-delivery + exec-e2e）。
 *
 * 真实 SSH 测试容器（ubuntu:24.04 openssh-server，127.0.0.1:2222 root/testpass123）
 * + buildServer 装配的真实 handlers（真实引擎：SshConnection / TaskRunner），
 * 客户端用真实 WebSocket 按 shared/messages.ts 协议交互，覆盖：
 *
 *   - manifest 下发：connect 后先收 manifest（任务数与后续 task-state 数一致，
 *     任务 id 与 fixture 清单逐一对齐），杜绝「未知任务 id」错配回归
 *   - 无依赖任务执行至成功：task-state pending→running→success + log 含预期
 *     stdout + progress 递增至 completed==total
 *   - 多个依赖闭合任务执行：依赖先行、全部 success、进度 completed==total
 *   - 失败决策态：failed → runner 停 awaiting-decision → retry 重进 running
 *     → 再失败 → skip → skipped
 *   - 内置清单连接：manifest 为 17 任务真实清单（与 assets/tasks.yaml 一致）
 *
 * Requires:
 *   docker compose -f docker-compose.test.yml up --build -d  （fenix-sshd-test）
 *   容器缺则测试内自动拉起；拉起失败则整组跳过。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { Client } from 'ssh2';
import { WebSocket } from 'ws';
import { parse as parseYaml } from 'yaml';
import { buildServer } from '../../server/index.js';
import { loadManifest } from '../../server/engine/manifest.js';
import { parseTaskManifest, type TaskManifest } from '../../shared/schema.js';
import type { ServerMessage } from '../../shared/messages.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
//  配置
// ---------------------------------------------------------------------------

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';
const FIXTURE_PATH = resolve(process.cwd(), 'tests/e2e/fixtures/exec-flow-tasks.yaml');

let fastify: Awaited<ReturnType<typeof buildServer>>;
let baseUrl: string;
/** 本测试文件打开的全部 WS socket（afterAll 兜底关闭，防失败用例残留）。 */
const openSockets: WebSocket[] = [];

// ---------------------------------------------------------------------------
//  容器前置（任务 3.4）：确认 fenix-sshd-test 在跑；缺则用 compose 拉起
// ---------------------------------------------------------------------------

/** 探测 SSH 容器是否可连（127.0.0.1:2222 root/testpass123）。 */
function probeSsh(timeoutMs = 5_000): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = new Client();
    const timer = setTimeout(() => {
      probe.end();
      resolveProbe(false);
    }, timeoutMs);
    probe.once('ready', () => {
      clearTimeout(timer);
      probe.end();
      resolveProbe(true);
    });
    probe.once('error', () => {
      clearTimeout(timer);
      resolveProbe(false);
    });
    probe.connect({
      host: HOST,
      port: PORT,
      username: USER,
      password: PASSWORD,
      readyTimeout: timeoutMs,
    });
  });
}

/** 保证 SSH 测试容器可达：探测 → 缺则 docker compose 拉起 → 等待就绪。 */
async function ensureSshdContainer(): Promise<boolean> {
  if (await probeSsh()) return true;
  try {
    await execFileAsync(
      'docker',
      ['compose', '-f', 'docker-compose.test.yml', 'up', '--build', '-d'],
      { env: { ...process.env, SSH_PASSWORD: PASSWORD }, timeout: 300_000 },
    );
  } catch (err) {
    console.warn(`fenix-sshd-test 容器拉起失败: ${(err as Error).message}`);
    return false;
  }
  for (let i = 0; i < 30; i++) {
    if (await probeSsh()) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

beforeAll(async (ctx) => {
  if (!(await ensureSshdContainer())) {
    console.warn(`SSH 测试容器 ${HOST}:${PORT} 不可达，exec-flow e2e 跳过`);
    ctx.skip();
    return;
  }

  // buildServer 起真实 handlers（单会话语义：所有 /ws 连接共享一个 SessionContext）。
  fastify = await buildServer({ host: '127.0.0.1', port: 0 });
  await fastify.listen({ host: '127.0.0.1', port: 0 });
  const addr = fastify.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `ws://127.0.0.1:${port}/ws`;
}, 60_000);

afterAll(async () => {
  // 兜底清理：失败用例可能未走到 teardownSession——关闭全部残留 WS，
  // 并经由 disconnect 触发会话清理（runner/SSH 连接释放），避免
  // fastify.close() 因活跃 SSH 连接而挂起。
  for (const ws of openSockets) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'disconnect' }));
        await new Promise((r) => setTimeout(r, 150));
      }
      ws.close();
    } catch {
      /* 已关闭 */
    }
  }
  if (fastify) await fastify.close().catch(() => {});
});

// ---------------------------------------------------------------------------
//  消息收集器（顺序消费语义：游标推进，杜绝陈旧消息错配）
// ---------------------------------------------------------------------------

interface Collector {
  waitFor(predicate: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  drain(): ServerMessage[];
}

/**
 * 顺序消息收集器：内部维护 `consumed` 游标，waitFor 只扫描游标之后的
 * 未消费消息，命中即把游标推进到命中点之后。这样：
 *   - 前一动作残留的陈旧消息（如首次 exec 的 running）不会命中后续动作的
 *     同谓词 waitFor（游标已越过它们）；
 *   - 命中点之间的中间消息（log/progress 等）被后续 waitFor 自动跳过。
 * 时序上等价于「按到达顺序逐条断言」，避免多动作共享缓冲时的错配竞态。
 */
function createCollector(ws: WebSocket): Collector {
  const buffer: ServerMessage[] = [];
  let consumed = 0;
  const waiters: Array<{
    predicate: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    reject: (e: Error) => void;
  }> = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf8')) as ServerMessage;
    buffer.push(msg);
    const idx = waiters.findIndex((w) => w.predicate(msg));
    if (idx >= 0) {
      const [waiter] = waiters.splice(idx, 1);
      waiter.resolve(msg);
    }
  });

  return {
    waitFor(predicate, timeoutMs = 15_000): Promise<ServerMessage> {
      for (let i = consumed; i < buffer.length; i++) {
        if (predicate(buffer[i])) {
          const msg = buffer[i];
          consumed = i + 1; // 命中即消费到该点之后
          return Promise.resolve(msg);
        }
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const pending = buffer.slice(consumed).map((m) => {
            const p = m.payload as Record<string, unknown>;
            return `${m.type}:${p.taskId ?? p.state ?? ''}`;
          });
          reject(new Error(`等待服务器消息超时 (${timeoutMs}ms)，未消费缓冲 [${pending.join(', ')}]`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            consumed = buffer.length; // 命中（末尾新消息）即消费至当前末尾
            resolve(m);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      });
    },
    drain(): ServerMessage[] {
      const drained = buffer.splice(0);
      consumed = 0;
      return drained;
    },
  };
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    openSockets.push(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** fixture 清单 YAML 文本（测试内本地解析用于 id 对齐断言）。 */
async function fixtureYaml(): Promise<string> {
  return readFile(FIXTURE_PATH, 'utf8');
}

/** 解析 fixture 清单的任务 id 集合。 */
async function fixtureTaskIds(): Promise<string[]> {
  const parsed = parseTaskManifest(parseYaml(await fixtureYaml()));
  if (!parsed.ok) throw new Error(`fixture YAML 解析失败: ${JSON.stringify(parsed.errors)}`);
  return parsed.manifest.tasks.map((t) => t.id);
}

function connectMsg(manifestYaml?: string): string {
  return JSON.stringify({
    type: 'connect',
    payload: {
      host: HOST,
      port: PORT,
      username: USER,
      password: PASSWORD,
      ...(manifestYaml !== undefined ? { manifestYaml } : {}),
    },
  });
}

async function awaitReady(col: Collector): Promise<void> {
  await col.waitFor((m) => m.type === 'connection-status' && m.payload.state === 'ready');
}

/** 会话收尾：disconnect 确认后关闭 socket。 */
async function teardownSession(ws: WebSocket, col: Collector): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'disconnect' }));
    await col
      .waitFor((m) => m.type === 'connection-status' && m.payload.state === 'disconnected', 5_000)
      .catch(() => {});
  }
  ws.close();
}

/**
 * 新会话启动辅助：幂等 disconnect 清理残留，再 connect（可带 manifestYaml），
 * 等待 ready。返回 { ws, collector }。
 */
async function freshSession(manifestYaml?: string): Promise<{ ws: WebSocket; collector: Collector }> {
  const ws = await connectWs(baseUrl);
  const col = createCollector(ws);
  ws.send(JSON.stringify({ type: 'disconnect' }));
  await col
    .waitFor((m) => m.type === 'connection-status' && m.payload.state === 'disconnected', 10_000)
    .catch(() => {});
  col.drain();

  ws.send(connectMsg(manifestYaml));
  await awaitReady(col);
  return { ws, collector: col };
}

// ---------------------------------------------------------------------------
//  测试
// ---------------------------------------------------------------------------

describe('exec-flow e2e（真实 SSH）', () => {
  it('connect 携带 fixture 清单 → 先收 manifest（id 与 fixture 一致）→ exec echo-ok → pending→running→success + log + progress', async () => {
    const { ws, collector: col } = await freshSession(await fixtureYaml());

    // 1. manifest 先于首个 task-state 到达，任务 id 与 fixture 逐一对齐。
    const messages = col.drain();
    const manifestIdx = messages.findIndex((m) => m.type === 'manifest');
    const firstStateIdx = messages.findIndex((m) => m.type === 'task-state');
    expect(manifestIdx).toBeGreaterThanOrEqual(0);
    expect(manifestIdx).toBeLessThan(firstStateIdx);
    const manifestMsg = messages[manifestIdx] as { payload: { manifest: TaskManifest } };
    const manifestIds = manifestMsg.payload.manifest.tasks.map((t) => t.id).sort();
    expect(manifestIds).toEqual((await fixtureTaskIds()).sort());
    // 任务数与后续 task-state 数一致（connect 成功下发全量 pending 快照）。
    const stateCount = messages.filter((m) => m.type === 'task-state').length;
    expect(stateCount).toBe(manifestMsg.payload.manifest.tasks.length);

    // 2. 执行无依赖任务 echo-ok → 状态迁移 + 日志 + 进度。
    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['echo-ok'] } }));

    const running = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-ok' && m.payload.status === 'running',
    );
    expect(running).toEqual({ type: 'task-state', payload: { taskId: 'echo-ok', status: 'running' } });

    const log = await col.waitFor((m) => m.type === 'log' && m.payload.taskId === 'echo-ok');
    expect((log.payload as { stream: string }).stream).toBe('stdout');
    expect((log.payload as { data: string }).data).toContain('hello-from-exec');

    const success = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-ok' && m.payload.status === 'success',
    );
    expect(success).toEqual({ type: 'task-state', payload: { taskId: 'echo-ok', status: 'success' } });

    const progress = await col.waitFor(
      (m) => m.type === 'progress' && (m.payload as { completed: number }).completed === 1,
    );
    expect(progress.payload).toEqual({ completed: 1, total: 1 });

    await teardownSession(ws, col);
  });

  it('依赖闭包：exec [echo-ok, echo-dep] → 依赖先行、全部 success、进度 completed==total', async () => {
    const { ws, collector: col } = await freshSession(await fixtureYaml());

    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['echo-ok', 'echo-dep'] } }));

    // 依赖先行：echo-ok success 必须先于 echo-dep running 到达。
    await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-ok' && m.payload.status === 'success',
    );
    await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-dep' && m.payload.status === 'running',
    );

    const depSuccess = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-dep' && m.payload.status === 'success',
    );
    expect(depSuccess.payload.status).toBe('success');

    // 进度最终 completed==total（2/2）。
    const finalProgress = await col.waitFor(
      (m) => m.type === 'progress' && (m.payload as { completed: number; total: number }).completed === 2,
    );
    expect(finalProgress.payload).toEqual({ completed: 2, total: 2 });

    await teardownSession(ws, col);
  });

  it('失败决策态：exec fail-always → failed（runner 停 awaiting-decision）→ retry 重进 running → 再 failed → skip → skipped', async () => {
    const { ws, collector: col } = await freshSession(await fixtureYaml());

    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['fail-always'] } }));

    const failed = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'fail-always' && m.payload.status === 'failed',
      10_000,
    );
    expect(failed.payload.status).toBe('failed');

    // retry 仅在 runner 停 awaiting-decision 时有效：状态离开 failed 重进 running。
    ws.send(JSON.stringify({ type: 'retry', payload: { taskId: 'fail-always' } }));
    const reRunning = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'fail-always' && m.payload.status === 'running',
      10_000,
    );
    expect(reRunning.payload.status).toBe('running');

    // 命令仍 exit 1 → 再次失败回到决策态。
    await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'fail-always' && m.payload.status === 'failed',
      10_000,
    );

    // skip → 状态 skipped，队列收尾。
    ws.send(JSON.stringify({ type: 'skip', payload: { taskId: 'fail-always' } }));
    const skipped = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'fail-always' && m.payload.status === 'skipped',
      10_000,
    );
    expect(skipped.payload.status).toBe('skipped');

    // 全程无「未知任务 id」错误。
    expect(col.drain().filter((m) => m.type === 'error' && m.payload.message.includes('未知任务 id'))).toEqual([]);

    await teardownSession(ws, col);
  });

  it('内置清单连接 → manifest 为 17 任务真实清单（与 assets/tasks.yaml 一致），全程无「未知任务 id」错误', { timeout: 60_000 }, async () => {
    const { ws, collector: col } = await freshSession();

    // 未携带 manifestYaml → 服务端下发内置 assets/tasks.yaml 清单。
    const messages = col.drain();
    const manifestMsg = messages.find((m) => m.type === 'manifest') as {
      payload: { manifest: TaskManifest };
    } | undefined;
    expect(manifestMsg).toBeDefined();
    const builtin = await loadManifest(resolve(process.cwd(), 'assets/tasks.yaml'));
    expect(builtin.ok).toBe(true);
    if (!builtin.ok) throw new Error('内置清单加载失败');
    // 前后端任务 id 集合完全一致，杜绝错配回归。
    expect(manifestMsg!.payload.manifest.tasks.map((t) => t.id).sort()).toEqual(
      builtin.manifest.tasks.map((t) => t.id).sort(),
    );
    expect(manifestMsg!.payload.manifest.tasks.length).toBeGreaterThanOrEqual(15);

    // 执行路径已由 fixture tests（echo-ok/echo-dep/fail-always）充分覆盖，
    // 本用例专注 manifest 一致性：无需执行重量级内置任务（apt update 耗时
    // 30-180s+，受容器状态影响）。

    await teardownSession(ws, col);
  });
});
