/**
 * server/index.ts
 *
 * Service entry point.
 *
 *   - Fastify HTTP service listening ONLY on 127.0.0.1 (default port 3773)
 *   - Static hosting of web build output; placeholder response when the
 *     static directory is missing or empty (web/ is owned by add-web-ui)
 *   - /ws WebSocket endpoint (see ws.ts)
 *   - SIGINT/SIGTERM graceful shutdown: 断开 WS → 清理会话（隧道 + SSH）→
 *     关 HTTP。顺序不可调换，详见 buildServer 内注释。
 *   - Auto-open browser hook kept as an interface (disabled in headless env)
 *
 * Usage:
 *   FENIX_PORT=3773 node dist/server/index.js
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppConfigManager } from './config.js';
import { MessageRouter, registerWsPlugin, closeWsChannel } from './ws.js';
import { registerSessionHandlers, type SessionContext } from './handlers.js';
import { waitAtMost } from './timing.js';

export const DEFAULT_PORT = 3773;
export const ALLOWED_HOST = '127.0.0.1';

/** 会话资源清理（隧道注销需一次 SSH 往返）的等待上限；超时则放弃等待继续关闭。 */
export const SESSION_TEARDOWN_TIMEOUT_MS = 2_000;

/** 尝试打开浏览器的等待上限；外部命令不返回时不能拖住启动。 */
export const BROWSER_OPEN_TIMEOUT_MS = 1_000;

// `context` 由 buildServer 通过 decorate 挂载（见 ServerContext）。
declare module 'fastify' {
  interface FastifyInstance {
    context: ServerContext;
  }
}

// ---------------------------------------------------------------------------
//  Server context — tracks active resources for graceful shutdown
// ---------------------------------------------------------------------------

export interface ServerContext {
  /** 会话上下文：持有 SSH 连接 / 隧道 / 引擎，关闭时需 teardown。 */
  session: SessionContext;
  /** 关闭服务：断开 WS 与会话资源后再关 HTTP。幂等。 */
  close: () => Promise<void>;
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
  const session = registerSessionHandlers(router, {
    config: new AppConfigManager({ configDir: process.cwd() }),
    builtinManifestPath: resolve(process.cwd(), 'assets/tasks.yaml'),
    // 内置清单 files 字段相对 assets/ 目录解析（install-claude-code.sh 等），
    // 而 runner filesRoot 缺省 CWD——此处显式对齐，否则上传报 ENOENT。
    filesRoot: resolve(process.cwd(), 'assets'),
  });
  const wss = registerWsPlugin(fastify, { router, path: '/ws' });

  // 关闭顺序不可调换：先断开 WS，再清理会话（隧道 + SSH 连接），最后才是
  // HTTP。upgrade 之后的 socket 仍挂在 http server 的连接表里，不先断开，
  // `server.close()` 会一直等连接排空 —— 表现为收到 SIGTERM 后「不退出」。
  // 幂等：onClose 钩子与 context.close() 都走这里，重复调用复用同一 promise。
  let resourcesClosed: Promise<void> | null = null;
  const closeResources = (): Promise<void> => {
    resourcesClosed ??= (async () => {
      await closeWsChannel(wss);

      // teardown 内含一次 SSH 往返（隧道注销），对端失联时回调可能永不触发；
      // 限时等待，超时则放弃清理继续关闭（进程随后退出会由内核回收 socket）。
      const finished = await waitAtMost(session.teardown(), SESSION_TEARDOWN_TIMEOUT_MS);
      if (!finished) {
        fastify.log.warn(`会话清理超过 ${SESSION_TEARDOWN_TIMEOUT_MS}ms 未完成，放弃等待并继续关闭`);
      }
    })();
    return resourcesClosed;
  };

  const context: ServerContext = {
    session,
    close: async () => {
      fastify.log.info('正在关闭服务…');
      await closeResources();
      await fastify.close();
    },
  };

  // 直接调用 fastify.close()（测试 / 嵌入方）时同样清理资源。
  fastify.addHook('onClose', closeResources);

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

    // 信号监听尽早注册：注册之前的 SIGTERM/SIGINT 会被系统默认处理直接杀掉
    // 进程，既没有优雅清理也看不到任何日志。
    let exiting = false;
    const shutdown = async (signal: string) => {
      if (exiting) {
        // 第二次信号：清理卡住时的强制出口（Ctrl+C 连按两次）。
        fastify.log.warn(`再次收到 ${signal}，强制退出`);
        process.exit(1);
      }
      exiting = true;
      fastify.log.info(`收到 ${signal}，开始优雅退出`);
      await fastify.context.close();
      // 不立即 process.exit：留出时间让已排队的 close 帧等写出落地（否则
      // 客户端看到的是 1006 异常断开而非 1001）。unref 后若无其它句柄，
      // 进程自然退出；仍有残留句柄时由该定时器兜底强制退出。
      setTimeout(() => {
        fastify.log.warn('仍有句柄残留，强制退出');
        process.exit(0);
      }, 200).unref();
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    if (shouldAutoOpenBrowser(options.noBrowser)) {
      // 尽力而为，且必须有上限：`xdg-open` 等外部命令在无头环境里可能不返回，
      // 不能让它把启动流程挂在这里。
      await waitAtMost(openBrowser(bound), BROWSER_OPEN_TIMEOUT_MS);
    }
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
