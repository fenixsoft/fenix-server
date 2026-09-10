/**
 * server/ws.ts
 *
 * WebSocket channel and message router on Fastify.
 *
 * Endpoint:  /ws  (raw WebSocket upgrade via 'ws' on the underlying server)
 *
 * Protocol:
 *   Client → { type, payload }  (JSON)
 *   Server → ServerMessage (discriminated union from shared/messages.ts)
 *
 * Routing: handlers are registered by `type`; unknown types get an `error`
 * reply without closing the connection; invalid JSON is tolerated and never
 * crashes the process.
 */
import { WebSocketServer, WebSocket, type ServerOptions } from 'ws';
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '../shared/messages.js';

// ---------------------------------------------------------------------------
//  Router
// ---------------------------------------------------------------------------

export type MessageHandler = (
  payload: ClientMessage['payload'],
  send: (msg: ServerMessage) => void,
  socket: WebSocket,
) => void | Promise<void>;

type HandlerMap = Map<string, MessageHandler>;

export class MessageRouter {
  private handlers: HandlerMap = new Map();

  /** Register a handler for a client message `type`. */
  register(type: string, handler: MessageHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Dispatch a raw message. Returns a promise that resolves when the handler
   * finishes (or immediately for malformed/unknown messages). Never rejects.
   */
  async dispatch(raw: string, send: (msg: ServerMessage) => void, socket: WebSocket): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Invalid JSON → no crash, send an error back.
      send({ type: 'error', payload: { message: '非法 JSON 消息' } });
      return;
    }

    if (!isClientMessage(msg)) {
      send({ type: 'error', payload: { message: '消息缺少 type 字段或格式非法' } });
      return;
    }

    const handler = this.handlers.get(msg.type);
    if (!handler) {
      send({
        type: 'error',
        payload: { message: `未知的消息类型: ${msg.type}` },
      });
      return;
    }

    try {
      await handler(msg.payload, send, socket);
    } catch (err) {
      send({
        type: 'error',
        payload: { message: `消息处理失败: ${(err as Error).message}` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
//  Fastify plugin
// ---------------------------------------------------------------------------

export interface WsPluginOptions {
  router: MessageRouter;
  /** Custom path (default "/ws"). */
  path?: string;
}

/**
 * Register the /ws endpoint on a Fastify instance.
 * Requires the underlying Node http.Server; honours noServer upgrade handling.
 */
export function registerWsPlugin(
  fastify: FastifyInstance,
  options: WsPluginOptions,
): WebSocketServer {
  const { router } = options;
  const path = options.path ?? '/ws';

  const wss = new WebSocketServer({ noServer: true } as ServerOptions);

  fastify.server.on('upgrade', (request, socket, head) => {
    if (request.url === path) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const send = (msg: ServerMessage) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };
      // fire-and-forget; dispatch never rejects
      void router.dispatch(raw, send, socket);
    });

    socket.on('error', (err) => {
      fastify.log.warn({ err }, 'WebSocket 连接错误');
    });
  });

  return wss;
}

// ---------------------------------------------------------------------------
//  Guards
// ---------------------------------------------------------------------------

/**
 * Structural check: a client message is any object carrying a string `type`
 * field (payload optional). Unknown `type` strings are intentionally accepted
 * here so the router can reply "未知的消息类型" for them; only messages that
 * lack a `type` field are structurally invalid.
 */
function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string';
}