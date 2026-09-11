/**
 * server/index.ts
 *
 * Service entry point.
 *
 *   - Fastify HTTP service listening ONLY on 127.0.0.1 (default port 3773)
 *   - Static hosting of web build output; placeholder response when the
 *     static directory is missing or empty (web/ is owned by add-web-ui)
 *   - /ws WebSocket endpoint (see ws.ts)
 *   - SIGINT/SIGTERM graceful shutdown: close HTTP + active SSH connections
 *   - Auto-open browser hook kept as an interface (disabled in headless env)
 *
 * Usage:
 *   FENIX_PORT=3773 node dist/server/index.js
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SshConnection } from './ssh/connection.js';
import { AppConfigManager } from './config.js';
import { MessageRouter, registerWsPlugin } from './ws.js';
import { registerSessionHandlers } from './handlers.js';

export const DEFAULT_PORT = 3773;
export const ALLOWED_HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
//  Server context — tracks active resources for graceful shutdown
// ---------------------------------------------------------------------------

export interface ServerContext {
  /** Active SSH connections to close on shutdown. */
  connections: Set<SshConnection>;
  /** Called by main() before exiting; used by tests to tear down. */
  close?: () => Promise<void>;
}

export interface BuildServerOptions {
  /** HTTP listen host. MUST be 127.0.0.1 (security boundary). */
  host?: string;
  /** HTTP listen port. Default 3773. */
  port?: number;
  /** Absolute path to the web build output directory. Optional. */
  staticDir?: string;
  /** Router for /ws; a default one is created if omitted. */
  router?: MessageRouter;
  /** Shared context; a fresh one is created if omitted. */
  context?: ServerContext;
}

/**
 * Build (but do not start) the Fastify server.
 * Rejects when `host` is not 127.0.0.1 — the service must never be exposed
 * to the network.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const host = options.host ?? ALLOWED_HOST;
  if (host !== ALLOWED_HOST) {
    throw new Error(`服务仅允许监听 ${ALLOWED_HOST}，拒绝绑定 ${host}`);
  }

  const fastify = Fastify({ logger: true });

  // Static hosting of web build output (placeholder when missing/empty).
  const staticDir = options.staticDir
    ? resolve(options.staticDir)
    : resolve(process.cwd(), 'web/dist');

  if (existsSync(staticDir)) {
    await fastify.register(fastifyStatic, { root: staticDir });
    fastify.get('/', async (_req, reply) => {
      try {
        return await reply.sendFile('index.html');
      } catch {
        return placeholderPage(reply);
      }
    });
  } else {
    fastify.get('/', async (_req, reply) => placeholderPage(reply));
  }

  // Health path — used by the verification contract.
  fastify.get('/health', async () => ({ ok: true }));

  // WebSocket channel: 装配真实 handler 集（connect/exec/stop/retry/skip/
  // fixWithClaude/pty-input/tunnel-open/tunnel-test/disconnect/snapshot）。
  // 单会话语义：SessionContext 随 buildServer 创建，所有 /ws 连接共享。
  const router = options.router ?? new MessageRouter();
  registerSessionHandlers(router, {
    config: new AppConfigManager({ configDir: process.cwd() }),
    builtinManifestPath: resolve(process.cwd(), 'assets/tasks.yaml'),
  });
  registerWsPlugin(fastify, { router, path: '/ws' });

  // Graceful shutdown: track active SSH connections.
  const context: ServerContext = options.context ?? { connections: new Set() };

  const shutdown = async () => {
    fastify.log.info('正在关闭服务…');
    for (const conn of context.connections) conn.close();
    context.connections.clear();
    await fastify.close();
  };

  fastify.addHook('onClose', async () => {
    for (const conn of context.connections) conn.close();
    context.connections.clear();
  });

  context.close = shutdown;

  // Attach context for tests / consumers.
  fastify.decorate('context', context);

  return fastify;
}

// ---------------------------------------------------------------------------
//  main()
// ---------------------------------------------------------------------------

export interface MainOptions {
  host?: string;
  port?: number;
  staticDir?: string;
  /** When true, do not attempt to open the browser. Default: headless. */
  noBrowser?: boolean;
}

/**
 * Start the service and block. Resolves when the process is shutting down.
 * Auto-open browser is skipped when `noBrowser` is set, in headless
 * environments, or when FENIX_NO_BROWSER is truthy.
 */
export async function main(options: MainOptions = {}): Promise<void> {
  const host = options.host ?? ALLOWED_HOST;
  const port = options.port ?? Number(process.env.FENIX_PORT ?? DEFAULT_PORT);

  const fastify = await buildServer({
    host,
    port,
    staticDir: options.staticDir,
  });

  try {
    await fastify.listen({ host, port });
    const addr = fastify.server.address();
    const bound = typeof addr === 'object' && addr ? `http://${addr.address}:${addr.port}` : `http://${host}:${port}`;
    fastify.log.info(`Fenix Server 已启动: ${bound}`);

    if (!shouldAutoOpenBrowser(options.noBrowser)) {
      await openBrowser(bound).catch(() => {}); // best effort only
    }

    // Graceful shutdown on SIGINT / SIGTERM.
    let exiting = false;
    const shutdown = async (signal: string) => {
      if (exiting) return;
      exiting = true;
      fastify.log.info(`收到 ${signal}，开始优雅退出`);
      const context = (fastify as unknown as { context?: ServerContext }).context;
      for (const conn of context?.connections ?? []) conn.close();
      await fastify.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    fastify.log.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function placeholderPage(reply: { type: (s: string) => { send: (b: string) => void } }) {
  return reply.type('text/html').send(
    '<!doctype html><html><head><meta charset="utf-8"><title>Fenix Server</title></head>' +
      '<body><h1>Fenix Server</h1><p>前端构建产物尚未部署（由 add-web-ui 提供）。</p>' +
      '<p>WebSocket 端点：<code>/ws</code></p></body></html>',
  );
}

/**
 * Decide whether to auto-open the browser.
 * Disabled when: FENIX_NO_BROWSER set, CI/headless env, or explicit flag.
 */
function shouldAutoOpenBrowser(noBrowser?: boolean): boolean {
  if (noBrowser === true) return false;
  if (process.env.FENIX_NO_BROWSER && process.env.FENIX_NO_BROWSER !== '0') return false;
  if (process.env.CI) return false;
  return process.stdout.isTTY === true;
}

/** Best-effort cross-platform browser open. */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const { platform } = process;
  const command =
    platform === 'darwin' ? `open ${url}`
    : platform === 'win32' ? `start ${url}`
    : `xdg-open ${url}`;
  await new Promise<void>((resolvePromise, reject) => {
    exec(command, (err) => (err ? reject(err) : resolvePromise()));
  });
}

// Execute main when run directly (not imported).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  void main();
}
