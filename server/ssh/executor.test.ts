/**
 * server/ssh/executor.test.ts
 *
 * Integration tests for SshExecutor — requires fenix-sshd-test container.
 * Covers: stdout streaming, stderr split, exit codes, sequential execution,
 * and closed-connection errors.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';
import { SshExecutor, ConnectionClosedError } from './executor.js';

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('SshExecutor', () => {
  let conn: SshConnection;

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
  }, 10_000);

  afterAll(() => { conn?.close(); });

  it('echo hello → stdout 回调含 hello，退出码 0', async () => {
    const executor = new SshExecutor(conn);
    const chunks: Array<{ stream: string; data: string }> = [];

    const result = await executor.exec('echo hello', {
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.code).toBe(0);
    expect(chunks.some((c) => c.stream === 'stdout' && c.data.includes('hello'))).toBe(true);
    expect(result.stdout).toContain('hello');
  });

  it('echo err >&2 → stderr 分片标记且内容含 err', async () => {
    const executor = new SshExecutor(conn);
    const chunks: Array<{ stream: string; data: string }> = [];

    const result = await executor.exec('echo err >&2', {
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.code).toBe(0);
    expect(chunks.some((c) => c.stream === 'stderr' && c.data.includes('err'))).toBe(true);
    expect(result.stderr).toContain('err');
    // stdout must not contain the stderr payload
    expect(result.stdout).not.toContain('err');
  });

  it('exit 3 → 返回退出码 3', async () => {
    const executor = new SshExecutor(conn);
    const result = await executor.exec('exit 3');
    expect(result.code).toBe(3);
  });

  it('顺序执行两条命令互不干扰', async () => {
    const executor = new SshExecutor(conn);

    const first = await executor.exec('echo first');
    const second = await executor.exec('echo second');

    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe('first');
    expect(second.code).toBe(0);
    expect(second.stdout.trim()).toBe('second');
  });

  it('连接关闭后执行 → 立即抛 ConnectionClosedError 不挂起', async () => {
    const closedConn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await closedConn.connect();
    closedConn.close();

    const executor = new SshExecutor(closedConn);
    await new Promise((r) => setTimeout(r, 200)); // let close settle

    expect(() => executor.exec('echo x')).toThrow(ConnectionClosedError);
  });
});
