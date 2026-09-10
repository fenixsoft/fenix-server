/**
 * server/ssh/tunnel.ts
 *
 * 反向隧道管理：把客户端本地代理"带到"服务器。
 *
 *  服务器 127.0.0.1:<P>（forwardIn 注册的远程监听）
 *      │  SSH channel（forwarded-tcpip，复用已有连接）
 *   客户端 Node 服务 → net.connect(客户端本地代理)
 *      │  纯字节流 pipe，不解析代理协议（HTTP / SOCKS 通用）
 *   客户端代理（Clash / v2ray …）
 *
 * 端口策略：从 30000 起探测服务器侧空闲端口（`ss -tln`），跳过 20122
 * （预留给服务器 Clash 服务），被占自动换下一个；forwardIn 失败兜底重试。
 *
 * 生命周期：open() / close() / 状态查询；同一时刻最多一条隧道。
 * SSH 断线 → 隧道随之失效并发射状态事件；重连后可重新 open。
 *
 * 事件：
 *   status(status: TunnelStatus)  – 状态变更（closed/opening/open/error，含实际端口）
 */
import { EventEmitter } from 'node:events';
import { connect as tcpConnect } from 'node:net';
import type {
  AcceptConnection,
  ClientChannel,
  RejectConnection,
  TcpConnectionDetails,
} from 'ssh2';
import { SshConnection } from './connection.js';
import { SshExecutor } from './executor.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export type TunnelState = 'closed' | 'opening' | 'open' | 'error';

export interface TunnelStatus {
  state: TunnelState;
  /** 隧道实际绑定在服务器 127.0.0.1 的端口。 */
  remotePort?: number;
  /** 客户端本地代理地址（host:port）。 */
  clientProxy?: string;
  /** 错误原因（state=error 时给出）。 */
  error?: string;
}

export interface TunnelOptions {
  /** 客户端本地代理地址，如 "127.0.0.1:7890"。 */
  clientProxy: string;
  /** 端口探测起始值，默认 30000。 */
  startPort?: number;
  /** 需要跳过的端口集合，默认 [20122]（预留给服务器 Clash）。 */
  skipPorts?: number[];
  /** forwardIn 失败兜底重试上限，默认 5。 */
  maxRetries?: number;
  /** 客户端代理可达性验证超时（毫秒），默认 3000。 */
  proxyConnectTimeoutMs?: number;
}

/** 连通性测试结果：成功携带出口 IP，失败携带原因（不抛异常）。 */
export interface ConnectivityResult {
  ok: boolean;
  ip?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
//  TunnelManager
// ---------------------------------------------------------------------------

export class TunnelManager extends EventEmitter {
  private readonly executor: SshExecutor;
  private _status: TunnelStatus;
  private _opening?: Promise<TunnelStatus>;
  private readonly _channels = new Set<ClientChannel>();
  private _listening = false;

  private readonly _onTcpConnection = (
    _details: TcpConnectionDetails,
    accept: AcceptConnection<ClientChannel>,
    reject: RejectConnection,
  ): void => {
    if (this._status.state !== 'open') {
      reject();
      return;
    }
    let channel: ClientChannel;
    try {
      channel = accept();
    } catch {
      return;
    }
    this._channels.add(channel);
    channel.on('close', () => this._channels.delete(channel));
    this._pipeToClientProxy(channel);
  };

  private readonly _onSshClose = (): void => {
    if (this._status.state === 'closed') return;
    for (const ch of this._channels) {
      try {
        ch.destroy();
      } catch {
        /* 已销毁 */
      }
    }
    this._channels.clear();
    this._setStatus({ state: 'error', error: 'SSH 连接已断开，隧道失效' });
  };

  constructor(
    private readonly connection: SshConnection,
    private readonly options: TunnelOptions,
  ) {
    super();
    this.executor = new SshExecutor(connection);
    this._status = { state: 'closed', clientProxy: options.clientProxy };
    this.connection.on('close', this._onSshClose);
  }

  // -- Public getters -------------------------------------------------------

  get state(): TunnelState {
    return this._status.state;
  }

  get remotePort(): number | undefined {
    return this._status.remotePort;
  }

  /** 当前状态快照（不可变拷贝）。 */
  getStatus(): TunnelStatus {
    return { ...this._status };
  }

  // -- Lifecycle ------------------------------------------------------------

  /**
   * 开启隧道：验证客户端代理可达 → 探测空闲端口 → forwardIn 注册远程监听。
   * 隧道已开启时幂等返回现有状态；开启中并发调用复用同一 promise。
   */
  open(): Promise<TunnelStatus> {
    if (this._status.state === 'open') return Promise.resolve(this.getStatus());
    if (this._opening) return this._opening;
    this._opening = this.doOpen().finally(() => {
      this._opening = undefined;
    });
    return this._opening;
  }

  /**
   * 关闭隧道：注销服务器侧监听（unforwardIn）并销毁所有活跃 channel。
   * 未开启时是安全的 no-op。
   */
  async close(): Promise<void> {
    if (this._status.state === 'closed') return;

    this._unlistenTcpConnections();
    for (const ch of this._channels) {
      try {
        ch.destroy();
      } catch {
        /* 已销毁 */
      }
    }
    this._channels.clear();

    if (this._status.remotePort !== undefined) {
      await this.unregisterForward(this._status.remotePort).catch(() => {});
    }
    this._setStatus({ state: 'closed', clientProxy: this.options.clientProxy });
  }

  // -- Diagnostics ----------------------------------------------------------

  /**
   * 连通性测试：服务器执行 `curl -x http://127.0.0.1:<P> <url>`（默认 ipify）。
   * 隧道未开启或链路故障时快速返回失败原因（10 秒内），不挂起。
   */
  async testConnectivity(url = 'https://api.ipify.org'): Promise<ConnectivityResult> {
    if (this._status.state !== 'open' || this._status.remotePort === undefined) {
      return { ok: false, error: '隧道未开启，无法测试连通性' };
    }
    const port = this._status.remotePort;
    const command = `curl -sS -m 10 -x http://127.0.0.1:${port} '${url}' 2>&1`;
    try {
      const result = await this.executor.exec(command, {
        signal: AbortSignal.timeout(10_000),
      });
      if (result.code !== 0) {
        const detail = result.stdout.trim() || result.stderr.trim() || `curl 退出码 ${result.code}`;
        return { ok: false, error: detail };
      }
      const body = result.stdout.trim();
      if (!body) return { ok: false, error: '未获取到出口 IP' };
      return { ok: true, ip: body };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // -- Internal -------------------------------------------------------------

  private async doOpen(): Promise<TunnelStatus> {
    if (this.connection.state !== 'ready') {
      const msg = 'SSH 连接未就绪，无法开启隧道';
      this._setStatus({ state: 'error', clientProxy: this.options.clientProxy, error: msg });
      throw new Error(msg);
    }
    this._setStatus({ state: 'opening', clientProxy: this.options.clientProxy });

    const proxy = parseProxyAddress(this.options.clientProxy);
    if (!(await this.isProxyReachable(proxy))) {
      const msg = `客户端代理不可达，请检查代理地址 ${this.options.clientProxy}`;
      this._setStatus({ state: 'error', clientProxy: this.options.clientProxy, error: msg });
      throw new Error(msg);
    }

    const usedPorts = await this.detectUsedPorts();
    const startPort = this.options.startPort ?? 30000;
    const skipPorts = new Set(this.options.skipPorts ?? [20122]);
    const maxRetries = this.options.maxRetries ?? 5;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const port = nextFreePort(startPort, usedPorts, skipPorts);
      if (port === null) break;
      try {
        const boundPort = await this.registerForward(port);
        this._listenTcpConnections();
        this._setStatus({
          state: 'open',
          remotePort: boundPort,
          clientProxy: this.options.clientProxy,
        });
        return this.getStatus();
      } catch (err) {
        lastError = err as Error;
        usedPorts.add(port); // 该端口绑定失败，标记后换下一个
      }
    }

    const msg = `隧道建立失败${lastError ? `：${lastError.message}` : ''}`;
    this._setStatus({ state: 'error', clientProxy: this.options.clientProxy, error: msg });
    throw new Error(msg);
  }

  /** 客户端代理 TCP 可达性验证（open 前的快速试连）。 */
  private isProxyReachable(proxy: { host: string; port: number }): Promise<boolean> {
    const timeoutMs = this.options.proxyConnectTimeoutMs ?? 3000;
    return new Promise((resolve) => {
      const socket = tcpConnect({ host: proxy.host, port: proxy.port });
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ok);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(timeoutMs, () => done(false));
    });
  }

  /** 在服务器执行 `ss -tln` 解析监听端口集合；ss 缺失时返回空集（forwardIn 兜底）。 */
  private async detectUsedPorts(): Promise<Set<number>> {
    const ports = new Set<number>();
    try {
      const result = await this.executor.exec('ss -tln 2>/dev/null || true');
      for (const line of result.stdout.split('\n')) {
        const m = line.match(/^LISTEN\s+\S+\s+\S+\s+(\S+):(\d+)/);
        if (m) ports.add(Number(m[2]));
      }
    } catch {
      // 连接异常等 → 按无信息处理，靠 forwardIn 兜底重试
    }
    return ports;
  }

  private registerForward(port: number): Promise<number> {
    const client = this.connection.getClient();
    return new Promise((resolve, reject) => {
      client.forwardIn('127.0.0.1', port, (err, boundPort) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(boundPort ?? port);
      });
    });
  }

  private unregisterForward(port: number): Promise<void> {
    const client = this.connection.getClient();
    return new Promise((resolve, reject) => {
      client.unforwardIn('127.0.0.1', port, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 把一条 forwarded-tcpip channel 与客户端本地代理 TCP 对接。
   * 纯字节流双向 pipe；任一端关闭/出错即销毁另一端，不泄漏。
   */
  private _listenTcpConnections(): void {
    if (this._listening) return;
    this.connection.getClient().on('tcp connection', this._onTcpConnection);
    this._listening = true;
  }

  private _unlistenTcpConnections(): void {
    if (!this._listening) return;
    this.connection.getClient().removeListener('tcp connection', this._onTcpConnection);
    this._listening = false;
  }

  /**
   * 把一条 forwarded-tcpip channel 与客户端本地代理 TCP 对接。
   * 纯字节流双向 pipe；任一端关闭/出错即销毁另一端，不泄漏。
   */
  private _pipeToClientProxy(channel: ClientChannel): void {
    const proxy = parseProxyAddress(this.options.clientProxy);
    const socket = tcpConnect({ host: proxy.host, port: proxy.port });

    const teardown = () => {
      socket.destroy();
      channel.destroy();
    };
    channel.on('close', teardown);
    channel.on('error', teardown);
    socket.on('close', teardown);
    socket.on('error', teardown);

    socket.on('connect', () => {
      channel.pipe(socket);
      socket.pipe(channel);
    });
  }

  private _setStatus(status: TunnelStatus): void {
    this._status = status;
    this.emit('status', { ...status });
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** 解析 "host:port"（支持 IPv6 方括号形式）。 */
export function parseProxyAddress(addr: string): { host: string; port: number } {
  const bracketed = addr.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1], port: Number(bracketed[2]) };
  }
  const idx = addr.lastIndexOf(':');
  if (idx <= 0) {
    throw new Error(`客户端代理地址格式非法：${addr}（应为 host:port）`);
  }
  const host = addr.slice(0, idx);
  const port = Number(addr.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`客户端代理端口非法：${addr}`);
  }
  return { host, port };
}

/**
 * 从 startPort 起找第一个空闲且不在跳过列表的端口。
 * 返回 null 表示已无可用端口。
 */
export function nextFreePort(
  startPort: number,
  used: Set<number>,
  skip: Set<number>,
): number | null {
  for (let port = startPort; port <= 65535; port++) {
    if (used.has(port) || skip.has(port)) continue;
    return port;
  }
  return null;
}
