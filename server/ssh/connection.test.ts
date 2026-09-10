/**
 * server/ssh/connection.test.ts
 *
 * Integration tests for SshConnection — requires fenix-sshd-test container.
 * Environment variables:
 *   SSH_HOST  (default 127.0.0.1)
 *   SSH_PORT  (default 2222)
 *   SSH_PASSWORD  (required)
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('SshConnection', () => {
  // Guard: skip suite entirely when container is unreachable (CI without docker).
  beforeAll(async (ctx) => {
    const c = new Client();
    const up = await new Promise<boolean>((resolve) => {
      c.once('ready', () => { c.end(); resolve(true); });
      c.once('error', () => resolve(false));
      c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 5_000 });
    });
    if (!up) ctx.skip();
  }, 10_000);

  it('密码认证成功，连接进入 ready 状态', async () => {
    const conn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await conn.connect();
    expect(conn.state).toBe('ready');
    conn.close();
  });

  it('错误密码 → error 状态，errorCategory 为 AUTH_FAILED', async () => {
    const conn = new SshConnection({ host: HOST, port: PORT, username: USER, password: 'wrongpassword' });
    let caught: Error | undefined;
    try {
      await conn.connect();
    } catch (e) {
      caught = e as Error;
    }
    expect(conn.state).toBe('error');
    expect(caught).toBeDefined();
    expect(conn.errorCategory).toBe('AUTH_FAILED');
    conn.close();
  });

  it('服务器不可达 → error 状态，errorCategory 为 UNREACHABLE', async () => {
    const conn = new SshConnection({ host: '127.0.0.1', port: 59999, username: USER, password: PASSWORD });
    let caught: Error | undefined;
    try {
      await conn.connect();
    } catch (e) {
      caught = e as Error;
    }
    expect(conn.state).toBe('error');
    expect(caught).toBeDefined();
    expect(conn.errorCategory).toBe('UNREACHABLE');
    conn.close();
  });

  it('ready 后主动 close → closed 事件', async () => {
    const conn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await conn.connect();
    expect(conn.state).toBe('ready');

    const closed = new Promise<void>((resolve) => {
      conn.once('close', () => resolve());
    });

    conn.close();
    await closed;
    expect(conn.state).toBe('closed');
  });
});
