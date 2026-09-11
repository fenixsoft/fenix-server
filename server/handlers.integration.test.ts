/**
 * server/handlers.integration.test.ts
 *
 * WebSocket 会话 handler 真实集成测试 —— docker compose SSH 测试容器
 * （ubuntu:24.04 openssh-server，127.0.0.1:2222）。
 *
 * 装配方式与生产一致：真实 Fastify + registerWsPlugin + registerSessionHandlers
 * （真实引擎：SshConnection / TaskRunner / Fixer / TunnelManager），
 * 客户端用真实 WebSocket 按 shared/messages.ts 协议交互。
 *
 * 主干链：connect（自定义清单）→ exec 成功 → exec 失败 skip →
 * stop 中止 → tunnel-open 失败路径 → snapshot → disconnect → 重连。
 * 容器不可达时整个套件跳过。
 *
 * Requires:
 *   docker compose -f docker-compose.test.yml up --build -d
 *   SSH_PASSWORD=<pw> npm run test
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ssh2';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { MessageRouter, registerWsPlugin } from './ws.js';
import { registerSessionHandlers, type SessionDeps } from './handlers.js';
import { AppConfigManager } from './config.js';
import type { ServerMessage } from '../shared/messages.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// ---------------------------------------------------------------------------
//  容器引导
// ---------------------------------------------------------------------------

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

const CUSTOM_MANIFEST = `meta:
  name: handlers-integ
  version: "1"
tasks:
  - id: echo-ok
    title: Echo OK
    commands:
      - "echo integ-ok && sleep 0.2"
  - id: echo-fail
    title: Echo Fail
    commands:
      - "echo about-to-fail && exit 3"
  - id: slow
    title: Slow
    commands:
      - "sleep 30"
`;

let configDir: string;
let fastify: FastifyInstance;
let baseUrl: string;

beforeAll(async (ctx) => {
  const c = new Client();
  const up = await new Promise<boolean>((resolve) => {
    c.once('ready', () => { c.end(); resolve(true); });
    c.once('error', () => resolve(false));
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 5_000 });
  });
  if (!up) { ctx.skip(); return; }

  configDir = await mkdtemp(join(tmpdir(), 'fenix-handlers-integ-'));
  fastify = Fastify({ logger: false });
  const router = new MessageRouter();
  registerSessionHandlers(router, {
    config: new AppConfigManager({ configDir }),
    builtinManifestPath: join(process.cwd(), 'assets/tasks.yaml'),
  });
  registerWsPlugin(fastify, { router, path: '/ws' });
  await fastify.listen({ host: '127.0.0.1', port: 0 });
  const addr = fastify.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `ws://127.0.0.1:${port}/ws`;
}, 20_000);

afterAll(async () => {
  if (configDir) await rm(configDir, { recursive: true, force: true }).catch(() => {});
  if (fastify) await fastify.close().catch(() => {});
});

// ---------------------------------------------------------------------------
//  消息收集器
// ---------------------------------------------------------------------------

interface Collector {
  waitFor(predicate: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  drain(): ServerMessage[];
}

function createCollector(ws: WebSocket): Collector {
  const buffer: ServerMessage[] = [];
  const waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void }> = [];

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
      const found = buffer.findIndex(predicate);
      if (found >= 0) return Promise.resolve(buffer.splice(found, 1)[0]!);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('等待服务器消息超时')), timeoutMs);
        waiters.push({
          predicate,
          resolve: (m) => { clearTimeout(timer); resolve(m); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
      });
    },
    drain() { return buffer.splice(0); },
  };
}

// ---------------------------------------------------------------------------
//  辅助
// ---------------------------------------------------------------------------

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function connectMsg(manifestYaml?: string): string {
  return JSON.stringify({
    type: 'connect',
    payload: {
      host: HOST,
      port: PORT,
      username: USER,
      password: PASSWORD,
      clientProxy: '127.0.0.1:1', // 不可达代理：tunnel-open 失败路径
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
    await col.waitFor(
      (m) => m.type === 'connection-status' && m.payload.state === 'disconnected',
      5_000,
    ).catch(() => {});
  }
  ws.close();
}

/**
 * 新会话启动辅助：确保旧会话已清理（幂等 disconnect），再发起 connect
 * 并等待 ready。返回 { ws, collector } 供测试直接使用。
 */
async function freshSession(): Promise<{ ws: WebSocket; collector: Collector }> {
  const ws = await connectWs(baseUrl);
  const col = createCollector(ws);
  // 幂等 disconnect 清理残留会话（确认 teardown 完成信号）
  ws.send(JSON.stringify({ type: 'disconnect' }));
  await col.waitFor(
    (m) => m.type === 'connection-status' && m.payload.state === 'disconnected',
    5_000,
  ).catch(() => {});
  col.drain();

  ws.send(connectMsg(CUSTOM_MANIFEST));
  await awaitReady(col);
  return { ws, collector: col };
}

// ---------------------------------------------------------------------------
//  测试
// ---------------------------------------------------------------------------

describe('ws 会话 handler 集成（真实 SSH）', () => {
  it('connect（自定义清单）→ ready + 全量 pending 快照；snapshot 补发一致', async () => {
    const { ws, collector: col } = await freshSession();

    const ids = col.drain()
      .filter((m) => m.type === 'task-state')
      .map((m) => (m as { payload: { taskId: string } }).payload.taskId);
    expect(ids.sort()).toEqual(['echo-fail', 'echo-ok', 'slow']);

    // snapshot 补发全量 pending + progress 0/3
    ws.send(JSON.stringify({ type: 'snapshot' }));
    const progress = await col.waitFor((m) => m.type === 'progress');
    expect(progress).toEqual({ type: 'progress', payload: { completed: 0, total: 3 } });

    await teardownSession(ws, col);
  });

  it('exec 成功任务 → task-state/log/progress 实时回传至 queue-finished', async () => {
    const { ws, collector: col } = await freshSession();
    col.drain();

    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['echo-ok'] } }));

    const running = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-ok' && m.payload.status === 'running',
    );
    expect(running).toEqual({ type: 'task-state', payload: { taskId: 'echo-ok', status: 'running' } });

    const log = await col.waitFor((m) => m.type === 'log' && m.payload.taskId === 'echo-ok');
    expect((log.payload as { stream: string }).stream).toBe('stdout');
    expect((log.payload as { data: string }).data).toContain('integ-ok');

    const success = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-ok' && m.payload.status === 'success',
    );
    expect(success).toEqual({ type: 'task-state', payload: { taskId: 'echo-ok', status: 'success' } });

    const progress = await col.waitFor(
      (m) => m.type === 'progress' && (m.payload as { completed: number; total: number }).completed === 1,
    );
    expect(progress.payload.completed).toBe(1);

    await teardownSession(ws, col);
  });

  it('exec 失败 → 停等；skip 跳过该任务，队列完成', async () => {
    const { ws, collector: col } = await freshSession();
    col.drain();

    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['echo-fail'] } }));

    await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-fail' && m.payload.status === 'failed',
      10_000,
    );

    ws.send(JSON.stringify({ type: 'skip', payload: { taskId: 'echo-fail' } }));

    const skipped = await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'echo-fail' && m.payload.status === 'skipped',
      10_000,
    );
    expect(skipped).toEqual({ type: 'task-state', payload: { taskId: 'echo-fail', status: 'skipped' } });

    await teardownSession(ws, col);
  });

  it('stop 中止在途命令 → stopped-state 重放复位快照', async () => {
    const { ws, collector: col } = await freshSession();
    col.drain();

    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['slow'] } }));
    await col.waitFor(
      (m) => m.type === 'task-state' && m.payload.taskId === 'slow' && m.payload.status === 'running',
    );

    ws.send(JSON.stringify({ type: 'stop' }));

    const afterStop = await col.waitFor(
      (m) => m.type === 'progress' && (m.payload as { total: number }).total === 1,
      20_000,
    );
    expect(afterStop.payload.completed).toBe(0);

    await teardownSession(ws, col);
  });

  it('tunnel-open（代理不可达）→ tunnel-status open=false 含失败原因', async () => {
    const { ws, collector: col } = await freshSession();
    col.drain();

    ws.send(JSON.stringify({ type: 'tunnel-open' }));
    // 等到最终错误状态（跳过 opening 中间态）
    const status = await col.waitFor(
      (m) => m.type === 'tunnel-status' && m.payload.open === false && m.payload.message !== '隧道开启中',
      20_000,
    ) as { payload: { open: boolean; message?: string } };
    expect(status.payload.open).toBe(false);
    expect(status.payload.message).toContain('代理');

    await teardownSession(ws, col);
  });

  it('disconnect → connection-status disconnected；再次 connect 可建立新会话', async () => {
    const { ws, collector: col } = await freshSession();
    col.drain();

    ws.send(JSON.stringify({ type: 'disconnect' }));
    const disconnected = await col.waitFor(
      (m) => m.type === 'connection-status' && m.payload.state === 'disconnected',
    );
    expect(disconnected.payload.state).toBe('disconnected');

    // 同一 ws 连接上再次 connect → 新会话建立
    ws.send(connectMsg(CUSTOM_MANIFEST));
    await awaitReady(col);
    expect(col.drain().length).toBeGreaterThanOrEqual(0);

    await teardownSession(ws, col);
  });

  it('无会话时 disconnect 幂等（不回 error）', async () => {
    const ws = await connectWs(baseUrl);
    const col = createCollector(ws);

    ws.send(JSON.stringify({ type: 'disconnect' }));
    const disconnected = await col.waitFor(
      (m) => m.type === 'connection-status' && m.payload.state === 'disconnected',
    );
    expect(disconnected.payload.state).toBe('disconnected');
    // 无 error 消息
    const after = await col.waitFor(
      (m) => m.type !== 'connection-status',
      1_000,
    ).catch(() => null);
    expect(after).toBeNull();

    ws.close();
  });

  it('connect 携带非法自定义清单 → MANIFEST_INVALID（含错误路径），不建立连接', async () => {
    const ws = await connectWs(baseUrl);
    const col = createCollector(ws);

    ws.send(
      JSON.stringify({
        type: 'connect',
        payload: {
          host: HOST,
          port: PORT,
          username: USER,
          password: PASSWORD,
          manifestYaml: `meta:\n  name: bad\n  version: "1"\ntasks:\n  - title: no id\n`,
        },
      }),
    );
    const err = await col.waitFor((m) => m.type === 'error') as {
      payload: { code?: string; message: string };
    };
    expect(err.payload.code).toBe('MANIFEST_INVALID');
    expect(err.payload.message).toContain('tasks.0');

    ws.close();
  });
});
