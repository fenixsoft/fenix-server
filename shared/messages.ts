/**
 * shared/messages.ts
 *
 * WebSocket message types shared between server and web (client).
 * Discriminated union on the `type` literal field.
 *
 * Client → Server messages: connect, exec, stop, retry, skip,
 *   fixWithClaude, pty-input, tunnel-open, tunnel-test, disconnect
 * Server → Client messages: connection-status, task-state, log,
 *   claude-output, tunnel-status, progress, error
 */

// ---------------------------------------------------------------------------
//  Shared payload helpers
// ---------------------------------------------------------------------------

export type TaskId = string;

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fixing'
  | 'skipped';

export type StreamTag = 'stdout' | 'stderr';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'error';

// ---------------------------------------------------------------------------
//  Client → Server
// ---------------------------------------------------------------------------

export interface ConnectPayload {
  /** SSH server host (IP or hostname). */
  host: string;
  /** SSH port (default 22). */
  port: number;
  /** SSH username. */
  username: string;
  /** SSH password. May be omitted when relying on key-based auth. */
  password?: string;
  /** Client-side proxy address for tunnel, e.g. "127.0.0.1:7890". */
  clientProxy?: string;
}

export interface ExecPayload {
  /** Ordered list of task IDs to execute. */
  taskIds: TaskId[];
}

export interface RetryPayload {
  taskId: TaskId;
}

export interface SkipPayload {
  taskId: TaskId;
}

export interface FixWithClaudePayload {
  taskId: TaskId;
}

export interface PtyInputPayload {
  /** Raw data to write into the PTY stdin. */
  data: string;
}

export interface TunnelOpenPayload {
  /** Remote port on the server to bind (0 = auto-select). */
  remotePort?: number;
}

export interface TunnelTestPayload {
  /** (No meaningful payload; test is triggered by presence of the message.) */
}

export interface DisconnectPayload {
  /** (No meaningful payload.) */
}

// --- Discriminated union ---------------------------------------------------

export type ClientMessage =
  | { type: 'connect'; payload: ConnectPayload }
  | { type: 'exec'; payload: ExecPayload }
  | { type: 'stop'; payload?: never }
  | { type: 'retry'; payload: RetryPayload }
  | { type: 'skip'; payload: SkipPayload }
  | { type: 'fixWithClaude'; payload: FixWithClaudePayload }
  | { type: 'pty-input'; payload: PtyInputPayload }
  | { type: 'tunnel-open'; payload?: TunnelOpenPayload }
  | { type: 'tunnel-test'; payload?: TunnelTestPayload }
  | { type: 'disconnect'; payload?: DisconnectPayload }
  | { type: 'snapshot'; payload?: never };

// ---------------------------------------------------------------------------
//  Server → Client
// ---------------------------------------------------------------------------

export interface ConnectionStatusPayload {
  state: ConnectionState;
  /** Human-readable detail (error reason, hostname, etc.). */
  message?: string;
}

export interface TaskStatePayload {
  taskId: TaskId;
  status: TaskStatus;
}

export interface LogPayload {
  taskId: TaskId;
  stream: StreamTag;
  data: string;
  /** Monotonically increasing sequence number within a task (for ordering). */
  seq?: number;
}

export interface ClaudeOutputPayload {
  data: string;
}

export interface TunnelStatusPayload {
  /** Whether the reverse tunnel is currently active. */
  open: boolean;
  /** Remote port the tunnel is bound to on the server. */
  remotePort?: number;
  /** Status detail, e.g. error message when open=false. */
  message?: string;
}

export interface ProgressPayload {
  completed: number;
  total: number;
}

export interface ErrorPayload {
  /** Machine-readable error code, e.g. "AUTH_FAILED", "UNREACHABLE". */
  code?: string;
  /** Human-readable error description. */
  message: string;
}

// --- Discriminated union ---------------------------------------------------

export type ServerMessage =
  | { type: 'connection-status'; payload: ConnectionStatusPayload }
  | { type: 'task-state'; payload: TaskStatePayload }
  | { type: 'log'; payload: LogPayload }
  | { type: 'claude-output'; payload: ClaudeOutputPayload }
  | { type: 'tunnel-status'; payload: TunnelStatusPayload }
  | { type: 'progress'; payload: ProgressPayload }
  | { type: 'error'; payload: ErrorPayload };
