/**
 * server/ssh/proxy-inject.ts
 *
 * 代理注入包装：对标记 `needs_proxy: true` 的命令，在执行前确保反向
 * 隧道已开启（未开启则自动 open），并以环境变量注入代理：
 *   http_proxy / https_proxy / HTTP_PROXY / HTTPS_PROXY = http://127.0.0.1:<隧道端口>
 *
 * 实现方式：`env` 命令前缀拼接到原命令之前（经 shell 注入环境变量），
 * 命令原文不被修改，也不污染远端 shell 的持久配置。对未标记
 * `needs_proxy` 的命令不做任何注入，原样透传。
 *
 * 依赖 add-task-engine 的 runner 命令执行包装点：runner 在执行每条
 * command 前调用 withProxy，把命令串与执行函数交给本模块。
 */
import { TunnelManager } from './tunnel.js';
import type { ExecResult } from './executor.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** 执行一个命令串并返回执行结果（如 SshExecutor.exec 的绑定）。 */
export type CommandExecutor = (command: string) => Promise<ExecResult>;

export interface WithProxyOptions {
  /** 任务清单中的 needs_proxy 标记；true 时注入代理环境变量。 */
  needsProxy: boolean;
}

export const PROXY_ENV_NAMES = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
] as const;

// ---------------------------------------------------------------------------
//  withProxy
// ---------------------------------------------------------------------------

/**
 * 包装命令执行：needs_proxy 时确保隧道开启并注入代理环境变量。
 *
 * - 未标记 needs_proxy → 直接执行原命令（不注入）
 * - 标记 needs_proxy 且隧道已开 → 以 env 前缀执行命令
 * - 标记 needs_proxy 且隧道未开 → 自动 open 后再执行；open 失败（如
 *   客户端代理不可达）时抛出明确错误，命令不被执行
 */
export async function withProxy(
  tunnel: TunnelManager,
  command: string,
  exec: CommandExecutor,
  options: WithProxyOptions,
): Promise<ExecResult> {
  if (!options.needsProxy) {
    return exec(command);
  }

  if (tunnel.state !== 'open') {
    // open 失败时抛出（如"客户端代理不可达，请检查代理地址 …"）
    await tunnel.open();
  }
  const port = tunnel.remotePort;
  if (port === undefined) {
    throw new Error('隧道未建立，无法注入代理环境变量');
  }

  const proxyUrl = `http://127.0.0.1:${port}`;
  const prefix = PROXY_ENV_NAMES.map((name) => `${name}=${proxyUrl}`).join(' ');
  // 经 env 命令注入环境变量，命令原文（command）不变
  return exec(`env ${prefix} ${command}`);
}
