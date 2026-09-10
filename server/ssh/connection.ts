/**
 * server/ssh/connection.ts
 *
 * SSH connection manager built on ssh2.
 *
 * States:  connecting → ready → closed
 *                       ready → error
 *
 * Error categories (distinguishable by `errorCategory`):
 *   AUTH_FAILED  – password rejected by the remote sshd
 *   UNREACHABLE  – TCP connect refused / DNS / network failure
 *   TIMEOUT      – TCP connect timed out (readyTimeout or keepalive)
 *
 * Events emitted:
 *   stateChange(state, prev)   – on every state transition
 *   close()                    – after the TCP socket is fully torn down
 *   error(err, category?)      – categorised connection failure
 */
import { EventEmitter } from 'node:events';
import { Client, ConnectConfig } from 'ssh2';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export type ConnectionState = 'connecting' | 'ready' | 'closed' | 'error';

export type SshErrorCategory =
  | 'AUTH_FAILED'
  | 'UNREACHABLE'
  | 'TIMEOUT';

export interface SshConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** Seconds to wait for the 'ready' event. Default 15. */
  readyTimeoutSec?: number;
  /** Seconds between keepalive pings. Default 30. */
  keepaliveIntervalSec?: number;
  /** Max consecutive unanswered keepalives before the connection is
   *  considered dead. Default 3. */
  keepaliveMaxMiss?: number;
}

// ---------------------------------------------------------------------------
//  SshConnection
// ---------------------------------------------------------------------------

export class SshConnection extends EventEmitter {
  private client: Client;
  private _state: ConnectionState = 'closed';
  private _errorCategory?: SshErrorCategory;
  private _error?: Error;

  constructor(private config: SshConnectionConfig) {
    super();
    this.client = new Client();
    this._attachClientListeners();
  }

  // -- Public getters -------------------------------------------------------

  get state(): ConnectionState {
    return this._state;
  }

  get errorCategory(): SshErrorCategory | undefined {
    return this._errorCategory;
  }

  get error(): Error | undefined {
    return this._error;
  }

  // -- Public methods -------------------------------------------------------

  /**
   * Open the TCP connection and authenticate with password.
   * Resolves once the session is ready. Rejects (and transitions to `error`)
   * on failure.
   */
  connect(): Promise<void> {
    if (this._state === 'ready') return Promise.resolve();
    this._setState('connecting');

    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
      password: this.config.password,
      readyTimeout: (this.config.readyTimeoutSec ?? 15) * 1_000,
      keepaliveInterval: (this.config.keepaliveIntervalSec ?? 30) * 1_000,
      keepaliveCountMax: this.config.keepaliveMaxMiss ?? 3,
    };

    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        this._setState('ready');
        resolve();
      };

      const onError = (err: Error & { level?: string }) => {
        cleanup();
        const category = classifyError(err);
        this._errorCategory = category;
        this._error = err;
        this._setState('error');
        reject(err);
      };

      const onClose = () => {
        cleanup();
        if (this._state !== 'closed') this._setState('closed');
      };

      const onTimeout = () => {
        cleanup();
        const err = new Error(`SSH connection timed out to ${this.config.host}:${this.config.port ?? 22}`);
        this._errorCategory = 'TIMEOUT';
        this._error = err;
        this._setState('error');
        reject(err);
      };

      const cleanup = () => {
        this.client.removeListener('ready', onReady);
        this.client.removeListener('error', onError);
        this.client.removeListener('close', onClose);
        this.client.removeListener('timeout', onTimeout);
      };

      this.client.once('ready', onReady);
      this.client.once('error', onError);
      this.client.once('close', onClose);
      this.client.once('timeout', onTimeout);

      this.client.connect(connectConfig);
    });
  }

  /**
   * Gracefully close the connection. Emits 'close' after teardown.
   * Safe to call multiple times.
   */
  close(): void {
    if (this._state === 'closed' || this._state === 'error') return;
    // end() gracefully closes the connection; ssh2 emits 'close' after.
    this.client.end();
  }

  /**
   * Terminate the connection immediately without waiting for a graceful
   * shutdown. Use when close() hangs.
   */
  forceClose(): void {
    if (this._state === 'closed') return;
    this._setState('closed');
    // destroy() cuts the socket immediately
    this.client.destroy();
  }

  /**
   * Expose the underlying ssh2 Client for command execution (executor.ts)
   * and SFTP operations (sftp.ts). Callers MUST NOT call connect/close
   * on this instance directly; lifecycle is managed by SshConnection.
   */
  getClient(): Client {
    return this.client;
  }

  // -- Internal -------------------------------------------------------------

  private _setState(next: ConnectionState): void {
    const prev = this._state;
    if (prev === next) return;
    this._state = next;
    this.emit('stateChange', next, prev);
  }

  private _attachClientListeners(): void {
    // After a connection is closed (e.g. remote hang-up), mark as closed.
    this.client.on('close', () => {
      if (this._state !== 'error') this._setState('closed');
      this.emit('close');
    });
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Classify a raw ssh2 error into a consumer-friendly category.
 *
 * ssh2 sets `level` on `ClientErrorExtensions`:
 *   'client-socket' – TCP / DNS level
 *   'client-ssh'    – SSH protocol level (auth, disconnect)
 */
function classifyError(err: Error & { level?: string; description?: string }): SshErrorCategory {
  if (err.level === 'client-ssh') {
    // Auth rejection surfaces via description or message keywords
    const msg = (err.description ?? err.message ?? '').toLowerCase();
    if (/auth|password|permission|denied/.test(msg)) return 'AUTH_FAILED';
  }
  if (err.level === 'client-socket') {
    const msg = (err.message ?? '').toLowerCase();
    if (/timeout|timed? out/.test(msg)) return 'TIMEOUT';
    return 'UNREACHABLE';
  }
  // Fallback heuristics when ssh2 omits `level`
  const msg = (err.message ?? '').toLowerCase();
  if (/timeout|timed? out/.test(msg)) return 'TIMEOUT';
  if (/econnrefused|econnreset|enotfound|dns/i.test(msg)) return 'UNREACHABLE';
  if (/auth|password|permission|denied/i.test(msg)) return 'AUTH_FAILED';
  return 'UNREACHABLE'; // safest default – treat unknown as network error
}
