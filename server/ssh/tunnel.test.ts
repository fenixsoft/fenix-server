/**
 * server/ssh/tunnel.test.ts
 *
 * Integration tests for TunnelManager — requires fenix-sshd-test container.
 *
 * Topology:
 *   容器内 curl -x http://127.0.0.1:<隧道端口> http://127.0.0.1:<目标端口>/hello
 *     → SSH 隧道（forwardIn 注册在服务器 127.0.0.1）
 *     → 宿主机 mock 代理（解析绝对 URI 并转发）
 *     → 宿主机目标 HTTP 服务器
 *
 * Covers: 全链路代理请求、channel 清理、端口选择/顺延/跳过 20122、
 * 重复 open、断线失效、显式关闭注销监听。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';
import { SshExecutor } from './executor.js';
import { TunnelManager, parseProxyAddress, nextFreePort, type TunnelStatus } from './tunnel.js';

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('TunnelManager', () => {
  let conn: SshConnection;
  let executor: SshExecutor;
  let proxy: MockProxy;
  let target: TargetServer;

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
    executor = new SshExecutor(conn);
    // 宿主机"客户端本地代理" + 可达目标（均在测试进程内监听 127.0.0.1）
    target = await createTargetServer();
    proxy = await createMockProxy();
  }, 15_000);

  afterAll(async () => {
    proxy?.close();
    target?.close();
    conn?.close();
  });

  it('全链路代理请求：容器内 curl -x 经隧道访问宿主机目标，链路全通', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    const status = await tunnel.open();
    expect(status.state).toBe('open');
    expect(status.remotePort).toBeDefined();

    const result = await executor.exec(
      `curl -sS -m 10 -x http://127.0.0.1:${status.remotePort} http://127.0.0.1:${target.port}/hello`,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PROXY-TARGET-OK');

    await tunnel.close();
  });

  it('channel 关闭联动清理：请求结束后 mock 代理连接数为 0', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    const status = await tunnel.open();

    const result = await executor.exec(
      `curl -sS -m 10 -x http://127.0.0.1:${status.remotePort} http://127.0.0.1:${target.port}/once`,
    );
    expect(result.code).toBe(0);

    await waitFor(() => proxy.activeConnections === 0, 5_000);
    expect(proxy.activeConnections).toBe(0);

    await tunnel.close();
  });

  it('首个空闲端口被选用：服务器 30000 未监听时隧道建立在 30000', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    const status = await tunnel.open();
    expect(status.remotePort).toBe(30000);
    await tunnel.close();
  });

  it('跳过 20122：即使探测范围覆盖 20122 也永不选择', async () => {
    const tunnel = new TunnelManager(conn, {
      clientProxy: `127.0.0.1:${proxy.port}`,
      startPort: 20122,
      skipPorts: [20122],
    });
    const status = await tunnel.open();
    expect(status.remotePort).not.toBe(20122);
    expect(status.remotePort).toBe(20123);
    await tunnel.close();
  });

  it('端口被占自动顺延：占用 30000 后隧道建立在 30001', async () => {
    // 用第二条 SSH 连接的 forwardIn 在服务器上占用 30000（关闭连接即释放）
    const oc = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await oc.connect();
    await new Promise<void>((resolve, reject) => {
      oc.getClient().forwardIn('127.0.0.1', 30000, (err) => (err ? reject(err) : resolve()));
    });
    await sleep(300);

    try {
      const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
      const status = await tunnel.open();
      expect(status.remotePort).toBe(30001);
      await tunnel.close();
    } finally {
      oc.close();
    }
  });

  it('重复 open 不产生双隧道：返回既有隧道且服务器侧仅一个监听', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    const s1 = await tunnel.open();
    const s2 = await tunnel.open();
    expect(s2.remotePort).toBe(s1.remotePort);
    expect(s2.state).toBe('open');

    // 服务器侧 ss -tln 中该端口只出现一次
    const ss = await executor.exec('ss -tln');
    const occurrences = (ss.stdout.match(new RegExp(`:${s1.remotePort}\\b`, 'g')) ?? []).length;
    expect(occurrences).toBe(1);

    await tunnel.close();
  });

  it('显式关闭注销监听：close 后服务器侧监听被注销', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    const status = await tunnel.open();
    expect(status.remotePort).toBe(30000);

    await tunnel.close();
    expect(tunnel.state).toBe('closed');

    const ss = await executor.exec('ss -tln');
    expect(ss.stdout).not.toMatch(new RegExp(`:${status.remotePort}\\b`));
  });

  it('SSH 断开联动失效：断开连接后隧道状态变为 error 并发射状态事件', async () => {
    const c2 = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await c2.connect();
    const tunnel = new TunnelManager(c2, { clientProxy: `127.0.0.1:${proxy.port}` });
    await tunnel.open();
    expect(tunnel.state).toBe('open');

    const events: TunnelStatus[] = [];
    tunnel.on('status', (s) => events.push(s));

    c2.close();
    await waitFor(() => tunnel.state === 'error', 5_000);
    expect(tunnel.state).toBe('error');
    expect(events.some((s) => s.state === 'error')).toBe(true);
  });

  it('客户端代理不可达：open 明确报错且不注册远端监听', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: '127.0.0.1:1' }); // 无服务端口
    await expect(tunnel.open()).rejects.toThrow(/客户端代理不可达/);
    expect(tunnel.state).toBe('error');
    expect(tunnel.getStatus().error).toContain('客户端代理不可达');
  });
});

// ---------------------------------------------------------------------------
//  Test helpers
// ---------------------------------------------------------------------------

class MockProxy {
  activeConnections = 0;
  private server: ReturnType<typeof createNetServer>;
  port = 0;

  constructor() {
    this.server = createNetServer((clientSocket) => {
      this.activeConnections++;
      let buffer = Buffer.alloc(0);
      let targetSocket: import('node:net').Socket | null = null;

      const teardown = () => {
        targetSocket?.destroy();
        clientSocket.destroy();
      };

      clientSocket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (targetSocket) {
          targetSocket.write(chunk);
          return;
        }
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const head = buffer.subarray(0, headerEnd + 4).toString('utf8');
        const firstLine = head.split('\r\n')[0];
        const m = firstLine.match(/^([A-Z]+)\s+(https?:\/\/[^\s]+)\s+(HTTP\/[\d.]+)$/);
        if (!m) {
          teardown();
          return;
        }
        const [, method, rawUrl, version] = m;
        const url = new URL(rawUrl);
        const host = url.hostname;
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));

        targetSocket = createConnection({ host, port });
        targetSocket.on('connect', () => {
          // 改写为 origin-form 后转发给目标
          const path = url.pathname + url.search;
          const rewritten = `${method} ${path || '/'} ${version}`;
          const newHead = head.replace(firstLine, rewritten);
          targetSocket!.write(newHead + buffer.subarray(headerEnd + 4).toString('utf8'));
          targetSocket!.pipe(clientSocket);
          clientSocket.pipe(targetSocket!);
        });
        targetSocket.on('error', teardown);
      });

      clientSocket.on('error', teardown);
      clientSocket.on('close', () => {
        this.activeConnections--;
        targetSocket?.destroy();
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  close(): void {
    this.server?.close();
  }
}

async function createMockProxy(): Promise<MockProxy> {
  const proxy = new MockProxy();
  await proxy.start();
  return proxy;
}

class TargetServer {
  private server: HttpServer;
  port = 0;

  constructor() {
    this.server = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('PROXY-TARGET-OK');
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', () => resolve()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  close(): void {
    this.server?.close();
  }
}

async function createTargetServer(): Promise<TargetServer> {
  const target = new TargetServer();
  await target.start();
  return target;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await sleep(50);
  }
}

// ---------------------------------------------------------------------------
//  Unit-ish assertions for exported helpers
// ---------------------------------------------------------------------------

describe('tunnel helpers', () => {
  it('parseProxyAddress 解析 host:port', () => {
    expect(parseProxyAddress('127.0.0.1:7890')).toEqual({ host: '127.0.0.1', port: 7890 });
    expect(parseProxyAddress('[::1]:7890')).toEqual({ host: '::1', port: 7890 });
  });

  it('parseProxyAddress 拒绝非法地址', () => {
    expect(() => parseProxyAddress('no-port')).toThrow();
    expect(() => parseProxyAddress('127.0.0.1:0')).toThrow();
    expect(() => parseProxyAddress('127.0.0.1:99999')).toThrow();
  });

  it('nextFreePort 跳过占用与跳过列表', () => {
    const used = new Set([30000, 30002]);
    const skip = new Set([20122]);
    expect(nextFreePort(30000, used, skip)).toBe(30001);
    expect(nextFreePort(20122, used, skip)).toBe(20123); // 20122 被跳过
  });

  it('nextFreePort 无可用端口返回 null', () => {
    const used = new Set(Array.from({ length: 65536 - 30000 }, (_, i) => 30000 + i));
    expect(nextFreePort(30000, used, new Set())).toBe(null);
  });
});
