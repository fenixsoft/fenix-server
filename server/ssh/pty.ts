/**
 * server/ssh/pty.ts
 *
 * PTY 会话管理 — 基于 ssh2 exec({ pty }) 的双向 PTY 封装。
 *
 * 以独立伪终端（pseudo-tty）启动远端命令：
 *   - 实时输出分片回调（stdout+stderr 合并经 PTY 输出，含 ANSI 转义）
 *   - 向会话写入输入（用户可在终端内与远端进程交互）
 *   - 终端尺寸同步（resize）
 *   - 进程退出检测（含退出码）
 *   - 主动终止（close channel），终止后连接可继续复用
 *
 * 实现选型：使用 client.exec 的 `pty` 选项，而非 shell() 交互模式。
 * 理由：exec 直接以命令行字符串启动远端进程，输出干净（无 shell 提示符
 * 与命令行回显噪音），退出码经 channel 'close' 事件直接可得；shell() 模式
 * 下命令嵌套在交互 shell 内，需额外 wrapper 才能拿到退出码，且会回显
 * 命令行干扰 claude 的输出流。exec + pty 已满足全部需求（双向交互、
 * 尺寸同步、退出检测、主动终止）。
 */
import type { ClientChannel } from 'ssh2';
import type { SshConnection } from './connection.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** 实时输出分片回调（data 为已解码 UTF-8 文本，含 ANSI 转义）。 */
export type PtyDataCallback = (data: string) => void;

/** 退出回调；code 为退出码，channel 关闭未携带退出码时为 null。 */
export type PtyExitCallback = (code: number | null) => void;

export interface PtyOpenOptions {
  /** 终端列数（默认 80）。 */
  cols?: number;
  /** 终端行数（默认 24）。 */
  rows?: number;
  /** $TERM 值（默认 xterm-256color）。 */
  term?: string;
  /** 注入远程进程的环境变量（经 exec env 选项下发）。 */
  env?: NodeJS.ProcessEnv;
  /** 输出分片回调。 */
  onData: PtyDataCallback;
  /** 退出回调。 */
  onExit: PtyExitCallback;
  /** 会话错误回调（可选；出错视为会话终止）。 */
  onError?: (err: Error) => void;
}

// ---------------------------------------------------------------------------
//  PtySession
// ---------------------------------------------------------------------------

/**
 * 单个 PTY 会话。同一实例同一时刻最多一个活跃会话；
 * 会话关闭后连接仍可复用（重新 open 或执行其他命令）。
 */
export class PtySession {
  private stream: ClientChannel | null = null;
  private _active = false;
  /** 是否因 close() 主动终止（供 onExit 区分「用户终止」与「正常退出」）。 */
  private _aborted = false;

  constructor(private readonly connection: SshConnection) {}

  /** 是否有活跃的 PTY 会话。 */
  get active(): boolean {
    return this._active;
  }

  /** 本次会话是否由 close() 主动终止。 */
  get wasAborted(): boolean {
    return this._aborted;
  }

  /**
   * 在远端启动 PTY 进程。
   *
   * @param command 要执行的 shell 命令行字符串
   *                （如 `claude --dangerously-skip-permissions '<prompt>'`）
   * @param options 回调与 PTY 配置
   * @throws 已有活跃会话时 / SSH 连接未就绪时
   */
  open(command: string, options: PtyOpenOptions): Promise<void> {
    if (this._active) {
      return Promise.reject(new Error('已有活跃的 PTY 会话，请先关闭'));
    }
    if (this.connection.state !== 'ready') {
      return Promise.reject(new Error('SSH 连接未就绪，无法启动 PTY 会话'));
    }

    this._active = true;
    this._aborted = false;

    const client = this.connection.getClient();
    const { onData, onExit, onError } = options;

    return new Promise<void>((resolve, reject) => {
      client.exec(
        command,
        {
          pty: {
            cols: options.cols ?? 80,
            rows: options.rows ?? 24,
            term: options.term ?? 'xterm-256color',
          },
          env: options.env,
        },
        (err, stream) => {
          if (err) {
            this._active = false;
            reject(err);
            return;
          }

          this.stream = stream;

          // PTY 模式下 stdout/stderr 合并到主通道输出，逐分片回调。
          stream.on('data', (data: Buffer | string) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
            onData(text);
          });

          stream.on('close', (code: number | null, signal?: string) => {
            this.stream = null;
            this._active = false;
            onExit(signal ? null : code);
          });

          if (onError) {
            stream.on('error', (streamErr: Error) => {
              this.stream = null;
              this._active = false;
              onError(streamErr);
            });
          }

          resolve();
        },
      );
    });
  }

  /** 向 PTY 写入输入数据（用户在终端内键入的内容）。 */
  write(data: string): void {
    if (!this.stream || !this._active) {
      throw new Error('无活跃的 PTY 会话');
    }
    this.stream.write(data);
  }

  /** 同步终端尺寸（no-op 当无活跃会话）。 */
  resize(cols: number, rows: number): void {
    if (!this.stream || !this._active) return;
    this.stream.setWindow(rows, cols, 0, 0);
  }

  /**
   * 主动终止 PTY 会话：关闭 channel 触发远端会话拆除，
   * 退出回调随后触发（code 为 null 或远端退出码），连接可继续复用。
   * 无活跃会话时是安全的 no-op。
   */
  close(): void {
    if (!this.stream) return;
    this._aborted = true;
    try {
      this.stream.close();
    } catch {
      // channel 已处于错误态 → 强制销毁兜底
      try {
        this.stream.destroy();
      } catch {
        /* 已销毁 */
      }
    }
  }
}
