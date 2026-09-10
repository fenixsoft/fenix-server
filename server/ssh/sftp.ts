/**
 * server/ssh/sftp.ts
 *
 * SFTP file uploads over an established SshConnection.
 *
 * Capabilities:
 *   uploadFile – single-file fastPut; auto-creates the remote parent dir.
 *   uploadDir  – recursive directory upload; auto-creates remote subdirs and
 *                preserves the relative path structure.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SFTPWrapper } from 'ssh2';
import { SshConnection } from './connection.js';

export class SftpError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SftpError';
  }
}

export class SshSftp {
  constructor(private readonly connection: SshConnection) {}

  private async openSftp(): Promise<SFTPWrapper> {
    if (this.connection.state !== 'ready') {
      throw new SftpError('连接未就绪，无法执行 SFTP 操作');
    }
    const client = this.connection.getClient();
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) reject(new SftpError('无法打开 SFTP 会话', err));
        else resolve(sftp);
      });
    });
  }

  /**
   * Upload a single local file to `remotePath` (fastPut semantics).
   * The remote parent directory is created automatically when missing.
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.openSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err?: Error | null) => {
        if (err) reject(new SftpError(`上传 ${localPath} 失败: ${err.message}`, err));
        else resolve();
      });
    });
  }

  /**
   * Recursively upload a local directory to `remoteRoot`.
   * Remote directories are created on demand and the relative structure of
   * the local directory is preserved.
   */
  async uploadDir(localRoot: string, remoteRoot: string): Promise<void> {
    const sftp = await this.openSftp();

    const ensureDir = async (dir: string): Promise<void> => {
      try {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(dir, (err?: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (err) {
        if (!isEnoent(err)) throw err;
        await ensureDir(parentDir(dir));
        // Recurse once; if dir now exists mkdir is EEXIST → swallow.
        try {
          await new Promise<void>((resolve, reject) => {
            sftp.mkdir(dir, (err?: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (retryErr) {
          if (!isEexist(retryErr)) throw retryErr;
        }
      }
    };

    const walk = async (localDir: string, remoteDir: string): Promise<void> => {
      await ensureDir(remoteDir);
      const entries = await fs.readdir(localDir, { withFileTypes: true });
      for (const entry of entries) {
        const lp = join(localDir, entry.name);
        const rp = `${remoteDir}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(lp, rp);
        } else if (entry.isFile()) {
          await new Promise<void>((resolve, reject) => {
            sftp.fastPut(lp, rp, (err?: Error | null) => {
              if (err) reject(new SftpError(`上传 ${lp} 失败: ${err.message}`, err));
              else resolve();
            });
          });
        }
      }
    };

    await walk(localRoot, remoteRoot);
  }
}

// -- helpers -----------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function isEexist(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST';
}

function parentDir(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.slice(0, idx);
}
