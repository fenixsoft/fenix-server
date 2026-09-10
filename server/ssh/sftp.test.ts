/**
 * server/ssh/sftp.test.ts
 *
 * Integration tests for SshSftp — requires fenix-sshd-test container.
 * Covers: single-file fastPut with auto-created remote dir, recursive
 * directory upload preserving structure.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ssh2';
import { SshConnection } from './connection.js';
import { SshSftp } from './sftp.js';
import { SshExecutor } from './executor.js';

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

describe('SshSftp', () => {
  let conn: SshConnection;
  let remoteBase: string;

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
    remoteBase = `/root/sftp-test-${Date.now()}`;
  }, 10_000);

  afterAll(async () => {
    if (conn?.state === 'ready') {
      const ex = new SshExecutor(conn);
      await ex.exec(`rm -rf ${remoteBase}`).catch(() => {});
    }
    conn?.close();
  });

  it('上传单文件到远端不存在的目录，目录自动创建且内容一致', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'sftp-single-'));
    const localFile = join(localDir, 'a.txt');
    await writeFile(localFile, 'iam-a-file');

    const sftp = new SshSftp(conn);
    await sftp.uploadFile(localFile, join(remoteBase, 'a.txt'));

    const remoteContent = await new Promise<string>((resolve, reject) => {
      conn.getClient().sftp((err, sf) => {
        if (err) return reject(err);
        sf.readFile(join(remoteBase, 'a.txt'), (e, data) => {
          if (e) return reject(e);
          resolve(data.toString('utf8'));
        });
      });
    });

    expect(remoteContent).toBe('iam-a-file');
    await rm(localDir, { recursive: true, force: true });
  });

  it('递归上传目录，远端结构与原文件内容一致', async () => {
    const localRoot = await mkdtemp(join(tmpdir(), 'sftp-dir-'));
    const subDir = join(localRoot, 'sub');
    await mkdir(subDir);
    await writeFile(join(subDir, 'deep.txt'), 'deep-content');
    await writeFile(join(localRoot, 'top.txt'), 'top-content');

    const sftp = new SshSftp(conn);
    await sftp.uploadDir(localRoot, remoteBase);

    const readRemote = (p: string) =>
      new Promise<string>((resolve, reject) => {
        conn.getClient().sftp((err, sf) => {
          if (err) return reject(err);
          sf.readFile(p, (e, data) => {
            if (e) return reject(e);
            resolve(data.toString('utf8'));
          });
        });
      });

    const remoteDeep = await readRemote(join(remoteBase, 'sub/deep.txt'));
    const remoteTop = await readRemote(join(remoteBase, 'top.txt'));

    expect(remoteDeep).toBe('deep-content');
    expect(remoteTop).toBe('top-content');
    await rm(localRoot, { recursive: true, force: true });
  });

  it('连接关闭后上传 → 抛 SftpError 不挂起', async () => {
    const closedConn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
    await closedConn.connect();
    closedConn.close();
    await new Promise((r) => setTimeout(r, 200));

    const sftp = new SshSftp(closedConn);
    await expect(sftp.uploadFile('nope.txt', '/tmp/nope.txt')).rejects.toThrow();
  });
});
