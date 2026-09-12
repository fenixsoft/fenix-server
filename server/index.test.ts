/**
 * server/index.test.ts
 *
 * Unit tests for the service entry point (Fastify server builder).
 * Covers the service-foundation spec scenarios.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { buildServer, DEFAULT_PORT, ALLOWED_HOST, SESSION_TEARDOWN_TIMEOUT_MS } from './index.js';
import type { SshConnectionLike } from './handlers.js';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const servers: import('fastify').FastifyInstance[] = [];

afterAll(async () => {
  for (const f of servers) await f?.close();
});

describe('buildServer', () => {
  it('默认启动：仅监听 127.0.0.1，GET /health 返回 200', async () => {
    const fastify = await buildServer();
    servers.push(fastify);
    await fastify.listen({ host: '127.0.0.1', port: 0 });

    const res = await fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
  });

  it('绑定非回环地址 → 启动失败并抛出明确错误', async () => {
    await expect(buildServer({ host: '0.0.0.0' })).rejects.toThrow(
      /仅允许监听 127\.0\.0\.1/,
    );
  });

  it('静态目录存在且含 index.html → GET / 返回文件内容', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'fenix-static-'));
    writeFileSync(join(staticDir, 'index.html'), '<html><body>Hello Fenix</body></html>', 'utf8');

    const fastify = await buildServer({ staticDir });
    servers.push(fastify);
    await fastify.listen({ host: '127.0.0.1', port: 0 });

    const res = await fastify.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Hello Fenix');
  });

  it('静态目录不存在 → 返回占位 HTML 不抛错', async () => {
    const fastify = await buildServer({ staticDir: '/no/such/dir' });
    servers.push(fastify);
    await fastify.listen({ host: '127.0.0.1', port: 0 });

    const res = await fastify.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Fenix Server');
    expect(res.payload).toContain('add-web-ui');
  });

  it('未知路由返回 404 不崩溃', async () => {
    const fastify = await buildServer();
    servers.push(fastify);
    await fastify.listen({ host: '127.0.0.1', port: 0 });

    const res = await fastify.inject({ method: 'GET', url: '/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
//  优雅退出
// ---------------------------------------------------------------------------

describe('优雅退出', () => {
  /** 把 promise 包上超时：回归时给出明确失败而不是让整个测试进程挂死。 */
  function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}：${ms}ms 内未完成`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /** 监听随机端口并返回实际端口号。 */
  async function listenOnRandomPort(): Promise<{ fastify: Awaited<ReturnType<typeof buildServer>>; port: number }> {
    const fastify = await buildServer();
    await fastify.listen({ host: '127.0.0.1', port: 0 });
    const addr = fastify.server.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('服务未监听');
    return { fastify, port: addr.port };
  }

  /** 连接 /ws 并等待握手完成。 */
  async function openWs(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, 'open');
    return ws;
  }

  it('存在打开的 WebSocket 连接时，close() 仍在限时内完成', async () => {
    const { fastify, port } = await listenOnRandomPort();
    const ws = await openWs(port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    // 先注册监听：服务端可能在 close() 返回前就完成了断开。
    const clientClosed = once(ws, 'close');

    await within(fastify.context.close(), 3_000, '优雅退出');

    // 服务端主动断开：客户端应收到 close 事件且不再处于 OPEN。
    await within(clientClosed.then(() => undefined), 3_000, '客户端连接关闭');
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('无连接时 close() 正常完成（对照组）', async () => {
    const { fastify } = await listenOnRandomPort();
    await within(fastify.context.close(), 3_000, '优雅退出');
  });

  it('close() 会关闭会话持有的 SSH 连接', async () => {
    const { fastify } = await listenOnRandomPort();

    const closed: string[] = [];
    const fakeConn: SshConnectionLike = {
      state: 'ready',
      connect: async () => {},
      close: () => closed.push('ssh'),
    };
    fastify.context.session.setConnection(fakeConn);

    await within(fastify.context.close(), 3_000, '优雅退出');

    expect(closed).toEqual(['ssh']);
  });

  it('close() 幂等：重复调用不抛错', async () => {
    const { fastify } = await listenOnRandomPort();
    await fastify.context.close();
    await expect(fastify.context.close()).resolves.toBeUndefined();
  });

  it('会话清理卡住时，close() 限时放弃等待并完成关闭', async () => {
    const { fastify } = await listenOnRandomPort();
    // 模拟 teardown 内部的 SSH 回调永不触发（如隧道注销时对端失联）。
    fastify.context.session.teardown = () => new Promise<void>(() => {});

    await within(
      fastify.context.close(),
      SESSION_TEARDOWN_TIMEOUT_MS + 2_000,
      '优雅退出（清理卡住的兜底）',
    );
  });
});
