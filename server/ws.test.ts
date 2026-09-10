import { describe, expect, it, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { MessageRouter, registerWsPlugin } from './ws.js';

async function setup(): Promise<{
  fastify: FastifyInstance;
  baseUrl: string;
  router: MessageRouter;
}> {
  const fastify = Fastify();
  const router = new MessageRouter();
  registerWsPlugin(fastify, { router });
  await fastify.listen({ host: '127.0.0.1', port: 0 });

  const address = fastify.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { fastify, baseUrl: `ws://127.0.0.1:${port}/ws`, router };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data.toString('utf8')));
    ws.once('error', reject);
  });
}

const servers: FastifyInstance[] = [];

afterAll(async () => {
  for (const f of servers) await f?.close();
});

describe('registerWsPlugin', () => {
  it('消息按 type 分发到注册的 handler', async () => {
    const { fastify, baseUrl, router } = await setup();
    servers.push(fastify);

    router.register('exec', (payload, send) => {
      send({ type: 'log', payload: { taskId: 't1', stream: 'stdout', data: `exec:${(payload as { taskIds: string[] }).taskIds.join(',')}` } });
    });

    const ws = await connect(baseUrl);
    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['a', 'b'] } }));

    const reply = await nextMessage(ws);
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe('log');
    expect(parsed.payload.data).toBe('exec:a,b');

    ws.close();
  });

  it('未知 type → 回复 error 消息且连接保持', async () => {
    const { fastify, baseUrl } = await setup();
    servers.push(fastify);

    const ws = await connect(baseUrl);
    ws.send(JSON.stringify({ type: 'no-such-type', payload: {} }));

    const reply = await nextMessage(ws);
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe('error');
    expect(parsed.payload.message).toContain('no-such-type');

    // Connection must still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('非法 JSON → 回复 error 消息且不崩溃', async () => {
    const { fastify, baseUrl } = await setup();
    servers.push(fastify);

    const ws = await connect(baseUrl);
    ws.send('this is not json {{');

    const reply = await nextMessage(ws);
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe('error');

    // Server still responsive after malformed input
    ws.send(JSON.stringify({ type: 'exec', payload: { taskIds: ['x'] } }));
    const reply2 = await nextMessage(ws);
    const parsed2 = JSON.parse(reply2);
    expect(parsed2.type).toBe('error'); // exec unregistered → error, proves liveness

    ws.close();
  });

  it('handler 抛出异常 → 回 error 消息不断开连接', async () => {
    const { fastify, baseUrl, router } = await setup();
    servers.push(fastify);

    router.register('connect', () => {
      throw new Error('boom');
    });

    const ws = await connect(baseUrl);
    ws.send(JSON.stringify({ type: 'connect', payload: { host: 'x', port: 22, username: 'u', password: 'p' } }));

    const reply = await nextMessage(ws);
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe('error');
    expect(String(parsed.payload.message)).toContain('boom');
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });
});