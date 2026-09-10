/**
 * tests/sshd/wait-ssh.ts
 *
 * Polls the test sshd container until it accepts a TCP connection and
 * successfully authenticates with ssh2.  Resolves on success; rejects
 * after exceeding the timeout.
 *
 * Usage (from a vitest setup, standalone script, or beforeAll):
 *
 *   await waitForSsh({ host: '127.0.0.1', port: 2222,
 *                      username: 'root', password });
 */
import { Client } from 'ssh2';

export interface WaitForSshOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Max wait in ms. Default 30 000. */
  timeoutMs?: number;
  /** Pause between retries in ms. Default 500. */
  intervalMs?: number;
}

/**
 * Wait for an SSH server to become reachable and accept password auth.
 * Rejects with an Error if the server is not ready within `timeoutMs`.
 */
export function waitForSsh(options: WaitForSshOptions): Promise<void> {
  const {
    host,
    port,
    username,
    password,
    timeoutMs = 30_000,
    intervalMs = 500,
  } = options;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const client = new Client();
      let settled = false;

      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        client.removeAllListeners();
        client.end();
        if (error) scheduleRetry(error);
        else resolve();
      };

      const scheduleRetry = (lastError: Error) => {
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `SSH container not ready within ${timeoutMs}ms. Last error: ${lastError.message}`,
            ),
          );
          return;
        }
        setTimeout(attempt, intervalMs);
      };

      client.once('ready', () => settle());
      client.once('error', (err: Error) => settle(err));
      client.once('close', () => {
        if (!settled) scheduleRetry(new Error('connection closed before ready'));
      });

      client.connect({ host, port, username, password, readyTimeout: 5000 });
    };

    attempt();
  });
}

/**
 * Convenience helper: read the SSH_PASSWORD env var and wait for the
 * default test container (127.0.0.1:2222).
 */
export async function waitForTestSsh(): Promise<void> {
  const password = process.env.SSH_PASSWORD;
  if (!password) throw new Error('SSH_PASSWORD env var is not set');
  await waitForSsh({ host: '127.0.0.1', port: 2222, username: 'root', password });
}
