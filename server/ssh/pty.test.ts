/**
 * server/ssh/pty.test.ts
 *
 * PtySession 集成测试 — 基于 fenix-sshd-test 容器（ubuntu:24.04，
 * openssh-server 于 127.0.0.1:2222）。
 *
 * 覆盖 claude-pty-session spec 的 PTY 双向会话场景：
 *   - 输出回调与退出检测（退出码 0）
 *   - 输入写入到达会话（cat 回显模式）
 *   - 主动终止会话（PTY 关闭、退出回调触发、连接可复用）
 *   - 连接复用：终止后同一连接继续执行命令
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';
import { SshExecutor } from './executor.js';
import { PtySession } from './pty.js';

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('PtySession', () => {
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

    // 在容器上部署 mock-claude.sh → /usr/local/bin/claude（幂等）
    const mockPath = resolve(__dirname, 'fixtures/mock-claude.sh');
    const mockContent = readFileSync(mockPath, 'utf8');
    const executor = new SshExecutor(conn);
    // 用 cat 写入二进制安全（文件较小），chmod 后即用。
    await executor.exec(`cat > /usr/local/bin/claude << 'MOCKEOF'\n${mockContent}\nMOCKEOF\nchmod +x /usr/local/bin/claude`);
  }, 15_000);

  afterAll(() => { conn?.close(); });

  it('输出回调与退出检测：echo 文本后退出码 0', async () => {
    const pty = new PtySession(conn);
    const chunks: string[] = [];
    const exited = new Promise<number | null>((resolve) => {
      void pty.open('printf "hello from pty\\n"; exit 0', {
        onData: (d) => chunks.push(d),
        onExit: resolve,
      });
    });

    const code = await exited;
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('hello from pty');
  });

  it('通过 mock-claude 脚本：输出回调收到文本、退出回调报告退出码 0', async () => {
    const pty = new PtySession(conn);
    const chunks: string[] = [];
    // 环境变量经 `env` 命令前缀注入（OpenSSH sshd 忽略 exec env 选项），
    // 这也是修复流程实际使用的方式，与 proxy-inject 一致。
    const exited = new Promise<number | null>((resolve) => {
      void pty.open(
        'env MOCK_CLAUDE_TEXT=mock-output-here MOCK_CLAUDE_EXIT_CODE=0 claude --dangerously-skip-permissions mock-spec-scenario',
        {
          onData: (d) => chunks.push(d),
          onExit: resolve,
        },
      );
    });

    const code = await exited;
    expect(code).toBe(0);
    expect(chunks.join('')).toContain('mock-output-here');
  });

  it('非零退出码如实上报', async () => {
    const pty = new PtySession(conn);
    const code = await new Promise<number | null>((resolve) => {
      void pty.open('exit 42', {
        onData: () => {},
        onExit: resolve,
      });
    });
    expect(code).toBe(42);
  });

  it('输入写入到达会话：cat 回显输入行', async () => {
    const pty = new PtySession(conn);
    const chunks: string[] = [];

    // cat 从 stdin 读取并原样输出；PTY 模式下 stdin 即终端输入。
    const opened = new Promise<void>((resolve) => {
      void pty.open('cat', {
        onData: (d) => chunks.push(d),
        onExit: () => {},
        onError: (err) => console.error('pty error', err),
      }).then(resolve);
    });
    await opened;

    pty.write('ping-from-tty\n');
    await new Promise((r) => setTimeout(r, 300));

    expect(chunks.join('')).toContain('ping-from-tty');

    // 清理：关闭会话，避免挂起
    pty.close();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('主动终止会话：close 触发退出回调、PTY 关闭、连接可复用', { timeout: 15_000 }, async () => {
    // 使用独立连接，避免共享连接上先前 channel 销毁延迟干扰 close 事件时序。
    const freshConn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await freshConn.connect();

    const pty = new PtySession(freshConn);
    const exited = new Promise<number | null>((resolve) => {
      pty.open('sleep 9999', {
        onData: () => {},
        onExit: resolve,
      }).catch(() => {});
    });

    // 等待会话真正建立
    await vi.waitFor(
      () => {
        expect(pty.active).toBe(true);
      },
      { timeout: 5_000 },
    );

    pty.close();

    // 退出回调触发（KILL + destroy 终止远端会话，退出回调触发）
    const code = await Promise.race([
      exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve('timeout' as unknown as number), 10_000)),
    ]);
    expect(code).not.toBe('timeout');
    expect(pty.active).toBe(false);

    // 同一连接继续复用：执行普通命令正常返回
    const executor = new SshExecutor(freshConn);
    const result = await executor.exec('echo still-alive');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('still-alive');

    freshConn.close();
  });

  it('连接关闭后 open → 报错不挂起', async () => {
    const closedConn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await closedConn.connect();
    closedConn.close();
    await new Promise((r) => setTimeout(r, 200));

    const pty = new PtySession(closedConn);
    await expect(
      pty.open('echo x', { onData: () => {}, onExit: () => {} }),
    ).rejects.toThrow();
  });

  it('已有活跃会话时重复 open → 报错', async () => {
    const pty = new PtySession(conn);
    const opened = new Promise<void>((resolve) => {
      void pty.open('sleep 9999', {
        onData: () => {},
        onExit: () => {},
      }).then(resolve);
    });
    await opened;
    expect(pty.active).toBe(true);

    await expect(
      pty.open('echo second', { onData: () => {}, onExit: () => {} }),
    ).rejects.toThrow('已有活跃的 PTY 会话');

    pty.close();
    await new Promise((r) => setTimeout(r, 200));
  });
});
