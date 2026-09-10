/**
 * server/ssh/executor.ts
 *
 * Command execution over an established SshConnection.
 *
 * Each command runs in its own ssh2 exec channel. stdout and stderr are
 * reported separately through a real-time callback with a stream tag.
 * The promise resolves with the exit code once the channel closes.
 *
 * Sequential execution: the caller can await each exec() in turn and the
 * client reuses the single TCP connection for every channel.
 */
import { SshConnection } from './connection.js';

export type StreamTag = 'stdout' | 'stderr';

export interface OutputChunk {
  stream: StreamTag;
  data: string;
}

export interface ExecResult {
  /** Shell exit code; null when the channel closed without a code. */
  code: number | null;
  /** Concatenated stdout (for convenience; prefer the stream callback). */
  stdout: string;
  /** Concatenated stderr. */
  stderr: string;
}

export interface ExecOptions {
  /** Real-time output callback; receives decoded UTF-8 chunks. */
  onOutput?: (chunk: OutputChunk) => void;
  /** Abort signal: rejects the pending exec and closes its channel. */
  signal?: AbortSignal;
}

export class ConnectionClosedError extends Error {
  constructor() {
    super('连接已关闭');
    this.name = 'ConnectionClosedError';
  }
}

export class SshExecutor {
  constructor(private readonly connection: SshConnection) {}

  /**
   * Execute a single shell command and stream its output.
   * Rejects when the connection is not ready, or when the channel errors.
   */
  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const client = this.connection.getClient();
    if (this.connection.state !== 'ready') {
      throw new ConnectionClosedError();
    }

    return new Promise<ExecResult>((resolve, reject) => {
      const onOutput = options.onOutput;

      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        const stdoutParts: string[] = [];
        const stderrParts: string[] = [];
        let settleCalled = false;

        const cleanup = () => {
          stream.removeAllListeners();
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          if (settleCalled) return;
          settleCalled = true;
          cleanup();
          reject(new Error('命令执行已中止'));
          // Close the channel to terminate the running remote command.
          stream.close();
        };

        stream.on('data', (data: Buffer | string) => {
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
          stdoutParts.push(text);
          onOutput?.({ stream: 'stdout', data: text });
        });

        // ssh2 exposes stderr as a Readable sub-stream on the channel,
        // not as an event.
        stream.stderr.on('data', (data: Buffer | string) => {
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
          stderrParts.push(text);
          onOutput?.({ stream: 'stderr', data: text });
        });

        stream.on('close', (code: number | null, signal?: string) => {
          if (settleCalled) return;
          settleCalled = true;
          cleanup();
          resolve({
            code: signal ? null : code,
            stdout: stdoutParts.join(''),
            stderr: stderrParts.join(''),
          });
        });

        stream.on('error', (streamErr: Error) => {
          if (settleCalled) return;
          settleCalled = true;
          cleanup();
          reject(streamErr);
        });

        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
  }
}
