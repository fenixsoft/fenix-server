/**
 * server/ssh/proxy-inject.test.ts
 *
 * Integration tests for withProxy — requires fenix-sshd-test container.
 * Covers: 注入代理变量执行命令、未标记不注入、隧道未开自动开、
 * 客户端代理不可达明确报错。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';
import { SshExecutor } from './executor.js';
import { TunnelManager } from './tunnel.js';
import { withProxy, PROXY_ENV_NAMES } from './proxy-inject.js';

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('withProxy', () => {
  let conn: SshConnection;
  let executor: SshExecutor;
  let proxy: MockProxy;

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
    proxy = await createMockProxy();
  }, 15_000);

  afterAll(async () => {
    proxy?.close();
    conn?.close();
  });

  it('注入代理变量执行命令：env 输出含四变量且值为隧道地址，命令原文不含拼接痕迹', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    await tunnel.open();

    const result = await withProxy(
      tunnel,
      'env | grep -i proxy || true',
      (cmd) => executor.exec(cmd),
      { needsProxy: true },
    );
    expect(result.code).toBe(0);

    const proxyUrl = `http://127.0.0.1:${tunnel.remotePort}`;
    for (const name of PROXY_ENV_NAMES) {
      expect(result.stdout).toContain(`${name}=${proxyUrl}`);
    }
    // 命令原文不变：隧道地址只在 env 前缀中，命令串本身不出现端口拼接痕迹
    expect(result.stdout).not.toContain('grep -i proxy');

    await tunnel.close();
  });

  it('未标记 needs_proxy 不注入：输出不含代理变量', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });

    const result = await withProxy(
      tunnel,
      'env | grep -i proxy || true',
      (cmd) => executor.exec(cmd),
      { needsProxy: false },
    );
    expect(result.code).toBe(0);
    // 未标记 → 直接原样执行，无注入变量
    expect(result.stdout).not.toMatch(/http_proxy=/i);
    expect(tunnel.state).toBe('closed'); // 隧道也不应被自动打开
  });

  it('隧道未开启时自动建立：needs_proxy 命令执行前自动 open', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: `127.0.0.1:${proxy.port}` });
    expect(tunnel.state).toBe('closed');

    const result = await withProxy(
      tunnel,
      'env | grep -i proxy || true',
      (cmd) => executor.exec(cmd),
      { needsProxy: true },
    );
    expect(result.code).toBe(0);
    expect(tunnel.state).toBe('open');
    expect(result.stdout).toMatch(/http_proxy=http:\/\/127\.0\.0\.1:/);

    await tunnel.close();
  });

  it('客户端代理不可达：withProxy 自动开隧道失败且错误指明检查代理地址', async () => {
    const tunnel = new TunnelManager(conn, { clientProxy: '127.0.0.1:1' }); // 无服务端口
    await expect(
      withProxy(tunnel, 'echo never', (cmd) => executor.exec(cmd), { needsProxy: true }),
    ).rejects.toThrow(/客户端代理不可达/);
    expect(tunnel.state).toBe('error');
  });
});

// ---------------------------------------------------------------------------
//  Test helpers
// ---------------------------------------------------------------------------

class MockProxy {
  private server: ReturnType<typeof createNetServer>;
  port = 0;

  constructor() {
    this.server = createNetServer((clientSocket) => {
      // 仅保持连接（隧道 open 的可达性验证需要），无需真实转发
      clientSocket.on('error', () => {});
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
