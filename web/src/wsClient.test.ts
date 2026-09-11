/**
 * web/src/wsClient.test.ts
 *
 * Regression coverage for the connecting-phase send buffer (BUG-01):
 * messages sent right after `connect()` (socket still CONNECTING, this.socket
 * not yet assigned) must not be dropped — they are buffered and flushed in
 * order on open, before the resync snapshot.
 */
import { describe, it, expect, vi } from 'vitest';
import { WsClient, type WebSocketLike } from './wsClient';

/** CONNECTING/OPEN readyState constants mirrored from the DOM. */
const CONNECTING = 0;
const OPEN = 1;

class FakeWebSocket implements WebSocketLike {
  readyState = CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer | Blob }) => void) | null = null;

  constructor(public url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '' });
  }

  /** Simulate the browser opening the socket. */
  open(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }

  /** Simulate an unexpected server-side close (drives auto-reconnect). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: '' });
  }
}

function makeClient(baseDelayMs = 50): {
  client: WsClient;
  sockets: FakeWebSocket[];
} {
  const sockets: FakeWebSocket[] = [];
  const client = new WsClient({
    baseDelayMs,
    createSocket: (url) => {
      const ws = new FakeWebSocket(url);
      sockets.push(ws);
      return ws;
    },
  });
  return { client, sockets };
}

describe('WsClient send buffering', () => {
  it('buffers messages sent before open and flushes them in order, before snapshot', () => {
    const { client, sockets } = makeClient();
    client.connect('ws://x/ws');
    // Socket not open yet: this would have been silently dropped pre-fix.
    client.send({ type: 'connect', payload: { host: '1.2.3.4', port: 22, username: 'root' } });
    client.send({ type: 'exec', payload: { taskIds: ['a'] } });

    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toEqual([]); // nothing before open

    sockets[0].open();

    const frames = sockets[0].sent.map((f) => JSON.parse(f) as { type: string });
    // Order preserved: buffered frames first, then the resync snapshot.
    expect(frames.map((f) => f.type)).toEqual(['connect', 'exec', 'snapshot']);
  });

  it('sends immediately once the socket is open', () => {
    const { client, sockets } = makeClient();
    client.connect('ws://x/ws');
    sockets[0].open();

    client.send({ type: 'tunnel-test' });
    client.send({ type: 'stop' });

    const frames = sockets[0].sent.map((f) => JSON.parse(f) as { type: string });
    expect(frames.map((f) => f.type)).toEqual(['snapshot', 'tunnel-test', 'stop']);
  });

  it('drops sends when not connecting (transport closed)', () => {
    const { client, sockets } = makeClient();
    client.send({ type: 'connect', payload: { host: 'h', port: 22, username: 'u' } });
    expect(sockets).toHaveLength(0); // no socket was ever created
  });

  it('clears the buffer on disconnect', () => {
    const { client, sockets } = makeClient();
    client.connect('ws://x/ws');
    client.send({ type: 'connect', payload: { host: 'h', port: 22, username: 'u' } });

    client.disconnect();
    expect(sockets[0].sent).toEqual([]); // never flushed

    // Reconnect after disconnect: stale frames must not reappear.
    client.connect('ws://x/ws');
    sockets[1].open();
    const frames = sockets[1].sent.map((f) => JSON.parse(f) as { type: string });
    expect(frames.map((f) => f.type)).toEqual(['snapshot']);
  });

  it('flushes buffered frames after an auto-reconnect', () => {
    const { client, sockets } = makeClient(10);
    client.connect('ws://x/ws');
    sockets[0].open();
    sockets[0].drop(); // unexpected close → auto-reconnect

    // While reconnecting, an action (gated by UI, but defensive here) queues.
    client.send({ type: 'exec', payload: { taskIds: ['b'] } });

    return vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    }).then(() => {
      sockets[1].open();
      const frames = sockets[1].sent.map((f) => JSON.parse(f) as { type: string });
      expect(frames.map((f) => f.type)).toEqual(['exec', 'snapshot']);
    });
  });

  it('caps the pending buffer at MAX_PENDING frames', () => {
    const { client, sockets } = makeClient();
    client.connect('ws://x/ws');
    for (let i = 0; i < 250; i++) {
      client.send({ type: 'exec', payload: { taskIds: [`t${i}`] } });
    }
    sockets[0].open();
    // 100 buffered exec frames + the resync snapshot.
    expect(sockets[0].sent).toHaveLength(101);
  });
});
