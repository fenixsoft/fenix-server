/**
 * web/src/wsClient.ts
 *
 * Singleton WebSocket client for the Fenix backend.
 *
 * Responsibilities:
 *   - Type-safe transport: `send()` accepts only ClientMessage; inbound JSON
 *     is validated structurally as ServerMessage before being delivered.
 *   - Exponential-backoff auto reconnect on unexpected close (base 1s, ×2,
 *     cap 15s, small jitter). Manual disconnect() stops reconnecting.
 *   - After every successful (re)connect, sends a `snapshot` request so the
 *     store can replay full task/tunnel state (app-shell requirement).
 *
 * The client is a plain event hub (no UI knowledge): consumers subscribe via
 * `onMessage` / `onStatus`. The singleton `wsClient` is what the app uses;
 * the class is exported for test injection of a fake WebSocket factory.
 */

import type { ClientMessage, ServerMessage } from '@fenix/shared/messages';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type WsStatus = 'connecting' | 'ready' | 'closed' | 'error';

export type MessageListener = (msg: ServerMessage) => void;
export type StatusListener = (status: WsStatus, detail?: string) => void;

/** WebSocket readyState constants, decoupled from the DOM global. */
const OPEN = 1;

export interface WsClientOptions {
  /** WebSocket factory; defaults to the browser global. Injectable for tests. */
  createSocket?: (url: string) => WebSocketLike;
  /** Backoff base in ms. Default 1000. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 15000. */
  maxDelayMs?: number;
}

/** Structural subset of WebSocket used by the client (testable without DOM). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: string | ArrayBuffer | Blob }) => void) | null;
}

// ---------------------------------------------------------------------------
//  WsClient
// ---------------------------------------------------------------------------

export class WsClient {
  private socket: WebSocketLike | null = null;
  private manualClose = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private status: WsStatus = 'closed';
  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();

  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly createSocket: (url: string) => WebSocketLike;

  constructor(options: WsClientOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 15000;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  // -- Subscriptions --------------------------------------------------------

  /** Subscribe to typed server messages. Returns an unsubscribe function. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Subscribe to connection-status transitions. Returns an unsubscribe fn. */
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  get connectionStatus(): WsStatus {
    return this.status;
  }

  // -- Connection control ---------------------------------------------------

  /**
   * Establish (or re-establish after a manual close) the WebSocket connection.
   * No-op when already connecting/ready.
   */
  connect(url: string): void {
    if (this.status === 'ready' || this.status === 'connecting') return;
    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.openSocket(url);
  }

  /**
   * Close the connection manually. Disables auto-reconnect until the next
   * `connect()` call.
   */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  // -- Send -----------------------------------------------------------------

  /**
   * Send a typed client message. Silently drops when the socket is not open —
   * the UI is gated on connection status, so this is an invariant, not an
   * error path.
   */
  send(msg: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  // -- Internals ------------------------------------------------------------

  private openSocket(url: string): void {
    this.setStatus('connecting');
    const socket = this.createSocket(url);

    socket.onopen = () => {
      this.socket = socket;
      this.reconnectAttempts = 0;
      this.setStatus('ready');
      // Reconnect resync: request a full state snapshot from the server.
      this.send({ type: 'snapshot' });
    };

    socket.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      if (!raw) return;
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // malformed frame — drop silently, keep the connection
      }
      if (!isServerMessage(msg)) return;
      for (const listener of this.messageListeners) listener(msg);
    };

    socket.onerror = () => {
      // 'error' is always followed by 'close'; the close handler schedules
      // the reconnect, so nothing to do here except surface the transition.
      this.setStatus('error');
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.manualClose) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect(url);
    };
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      this.baseDelayMs * 2 ** this.reconnectAttempts,
      this.maxDelayMs,
    ) + Math.random() * 200;
    this.reconnectAttempts += 1;
    this.setStatus('connecting', '重连中');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(url);
    }, delay);
  }

  private setStatus(status: WsStatus, detail?: string): void {
    if (this.status === status && detail === undefined) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }
}

// ---------------------------------------------------------------------------
//  Guard
// ---------------------------------------------------------------------------

/** Structural check for a server message (type field + payload object). */
function isServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string' && (record.payload === undefined || isObject(record.payload));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ---------------------------------------------------------------------------
//  Singleton
// ---------------------------------------------------------------------------

/** Application-wide client instance (module singleton). */
export const wsClient = new WsClient();
