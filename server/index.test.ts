/**
 * server/index.test.ts
 *
 * Unit tests for the service entry point (Fastify server builder).
 * Covers the service-foundation spec scenarios.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { buildServer, DEFAULT_PORT, ALLOWED_HOST } from './index.js';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
