/**
 * server/engine/runner.ts
 *
 * TaskRunner — the serial execution state machine.
 *
 * Execution model (per design doc §4.2):
 *   - the queue is materialised ONCE in run(); after that, retry / skip /
 *     stop decisions drive continuation by queue order.
 *   - per task: upload `files` → execute `commands` in order → run `verify`
 *     when declared. Any failure stops that task's remaining steps.
 *   - a failed task parks the runner in an `awaiting-decision` state (the
 *     queue is NOT destroyed); the user decides retry / skip / stop.
 *   - `stop()` aborts the in-flight command and resets the queue.
 *
 * Events (EventEmitter style; the ws layer subscribes and translates them
 * into WebSocket messages):
 *   - 'task-state'      (taskId, status)
 *   - 'log'             ({ taskId, stream, data })  — real-time chunks
 *   - 'progress'        (completed, total)
 *   - 'stopped-state'   (snapshot)  — queue/statuses captured the moment a
 *                         stop interrupts the run (before the queue reset)
 *   - 'queue-finished'  ({ reason: 'completed' | 'stopped' })
 *
 * The runner does not depend on a transport layer: `executor` (command
 * execution) and `uploader` (file transfer) are injected interfaces, so
 * unit tests use in-memory fakes while the ws layer wires the real
 * SshExecutor / SshSftp.
 */
import { EventEmitter } from 'node:events';
import { join, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import type { TaskManifest } from '../../shared/schema.js';
import type { ExecResult, OutputChunk } from '../ssh/executor.js';
import { SshSftp } from '../ssh/sftp.js';
import { topoSort } from './planner.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fixing'
  | 'skipped';

export type StreamTag = 'stdout' | 'stderr';

/** Command execution seam — SshExecutor structurally satisfies this. */
export interface CommandExecutor {
  exec(
    command: string,
    options?: { onOutput?: (chunk: OutputChunk) => void; signal?: AbortSignal },
  ): Promise<ExecResult>;
}

/** File transfer seam — resolves a manifest-relative local path to upload. */
export interface FileUploader {
  upload(localPath: string, remotePath: string): Promise<void>;
}

export interface TaskRunnerOptions {
  manifest: TaskManifest;
  executor: CommandExecutor;
  uploader: FileUploader;
  /** Remote base dir for uploaded files. Default '/root/server-init'. */
  remoteRoot?: string;
  /** Local base dir for declared `files` (relative paths). Default CWD. */
  filesRoot?: string;
}

export interface RunnerSnapshot {
  /** Latest status of every task in the manifest. */
  states: Record<string, TaskStatus>;
  /** Tasks still awaiting execution (empty after completion/stop). */
  queue: string[];
  /** Task currently executing, if any. */
  currentTask: string | null;
  /** Failed task waiting for a retry/skip/stop decision, if any. */
  awaitingDecision: string | null;
  running: boolean;
  total: number;
  completed: number;
}

/**
 * 失败任务的修复上下文 —— 由 runner 在任务失败时记录，
 * fixer 用于构造 Claude 修复提示词（add-claude-fallback）。
 */
export interface FailureContext {
  taskId: string;
  /** 失败阶段：'upload' | `command:N`（1 基命令序号）| 'verify'。 */
  stage: string;
  /** 失败的命令原文；upload 阶段为空串。 */
  command: string;
  /** 收集到的错误输出尾部（截头留尾，上限由 runner 内部滚动缓冲决定）。 */
  errorTail: string;
}

// ---------------------------------------------------------------------------
//  Centralised state transition table
// ---------------------------------------------------------------------------

export type TaskEvent = 'start' | 'succeed' | 'fail' | 'skip' | 'fix';

/**
 * Legal state transitions:
 *   pending | failed | fixing --start--> running   (initial run, retry, fix-retry)
 *   running                          --succeed--> success
 *   running | fixing                 --fail--> failed
 *   failed | pending                 --skip--> skipped
 *   failed                           --fix--> fixing   (add-claude-fallback)
 *
 * Returns null for illegal transitions; `skipped` is only reachable from
 * failed/pending, never from running/success. `fixing` is entered from
 * failed (Claude 修复会话), and leaves via start（修复后重跑）或
 * fail（中止修复回退失败态）。
 */
export function transition(current: TaskStatus, event: TaskEvent): TaskStatus | null {
  switch (event) {
    case 'start':
      return current === 'pending' || current === 'failed' || current === 'fixing' ? 'running' : null;
    case 'succeed':
      return current === 'running' ? 'success' : null;
    case 'fail':
      return current === 'running' || current === 'fixing' ? 'failed' : null;
    case 'skip':
      return current === 'failed' || current === 'pending' ? 'skipped' : null;
    case 'fix':
      return current === 'failed' ? 'fixing' : null;
  }
}

// ---------------------------------------------------------------------------
//  TaskRunner
// ---------------------------------------------------------------------------

export class TaskRunner extends EventEmitter {
  private readonly manifest: TaskManifest;
  private readonly executor: CommandExecutor;
  private readonly uploader: FileUploader;
  private readonly remoteRoot: string;
  private readonly filesRoot: string;

  private states: Record<string, TaskStatus> = {};
  private queue: string[] = [];
  private runTaskIds: string[] = [];
  private currentTask: string | null = null;
  private awaitingDecision: string | null = null;
  private running = false;
  private stopRequested = false;
  private abortController: AbortController | null = null;
  private decisionWaiter: { resolve: (d: 'retry' | 'skip' | 'stop') => void } | null = null;
  /** State captured at the moment a run is stopped (before queue reset). */
  private _stopCapture: RunnerSnapshot | null = null;

  /** 任务失败时的修复上下文（add-claude-fallback 消费）。 */
  private readonly failureContexts = new Map<string, FailureContext>();
  /** 每任务输出滚动缓冲：保留最近 N 字节供「错误输出尾部」提取。 */
  private readonly outputTails = new Map<string, string>();
  private static readonly OUTPUT_TAIL_CAP = 16 * 1024;

  constructor(options: TaskRunnerOptions) {
    super();
    this.manifest = options.manifest;
    this.executor = options.executor;
    this.uploader = options.uploader;
    this.remoteRoot = (options.remoteRoot ?? '/root/server-init').replace(/\/+$/, '');
    this.filesRoot = options.filesRoot ?? process.cwd();
  }

  // -- Public getters -------------------------------------------------------

  get snapshotStates(): Readonly<Record<string, TaskStatus>> {
    return this.states;
  }

  get queued(): readonly string[] {
    return [...this.queue];
  }

  get total(): number {
    return this.runTaskIds.length;
  }

  get completed(): number {
    return this.runTaskIds.filter(
      (id) => this.states[id] === 'success' || this.states[id] === 'skipped',
    ).length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // -- Run lifecycle --------------------------------------------------------

  /**
   * Materialise the execution queue (topoSort) and run it serially.
   * Resolves when the queue finishes (completes, stops, or the last task
   * is skipped). Rejects when a selection references an unknown id or the
   * reachable dependency graph contains a cycle.
   */
  async run(taskIds: string[]): Promise<void> {
    if (this.running) throw new Error('执行器已在运行中');

    const queue = topoSort(taskIds, this.manifest.tasks);
    if (queue === null) {
      throw new Error('任务依赖存在环，无法生成执行队列');
    }

    // Fresh run: reset every manifest task to pending.
    const nextStates: Record<string, TaskStatus> = {};
    for (const task of this.manifest.tasks) nextStates[task.id] = 'pending';
    this.states = nextStates;

    this.queue = [...queue];
    this.runTaskIds = [...queue];
    this.currentTask = null;
    this.awaitingDecision = null;
    this.stopRequested = false;
    this.abortController = new AbortController();
    this.running = true;
    this._stopCapture = null;
    this.failureContexts.clear();
    this.outputTails.clear();

    this.emitProgress();

    await this.drainQueue();

    this.queue = [];
    this.currentTask = null;
    this.awaitingDecision = null;
    this.running = false;
    this.abortController = null;
    this.emitProgress();
    this.emit('queue-finished', { reason: this.stopRequested ? 'stopped' : 'completed' });
  }

  // -- User decisions -------------------------------------------------------

  /** Re-run the failed task currently awaiting a decision. No-op otherwise. */
  retry(taskId: string): void {
    if (this.awaitingDecision !== taskId) return;
    // 修复进行中禁止手动重试（重试语义由 fixer 经 retryAfterFix 接管）。
    if (this.states[taskId] === 'fixing') return;
    this.decisionWaiter?.resolve('retry');
  }

  /**
   * 修复会话结束后的自动重跑（fixer 调用）：绕过 fixing 期手动重试守卫，
   * 直接以 'retry' 决策驱动队列重跑该任务。
   */
  retryAfterFix(taskId: string): void {
    if (this.awaitingDecision !== taskId) return;
    this.decisionWaiter?.resolve('retry');
  }

  /** Mark the failed task skipped and continue with the rest of the queue. */
  skip(taskId: string): void {
    if (this.awaitingDecision !== taskId) return;
    if (this.states[taskId] === 'fixing') return;
    this.decisionWaiter?.resolve('skip');
  }

  /**
   * 把停等中的失败任务置为 fixing（Claude 修复会话开始）。
   * 仅当该任务处于停等（awaitingDecision）且状态为 failed 时生效。
   */
  fix(taskId: string): boolean {
    if (this.awaitingDecision !== taskId) return false;
    if (this.states[taskId] !== 'failed') return false;
    this.applyTransition(taskId, 'fix');
    return true;
  }

  /**
   * 中止修复：把 fixing 状态的任务置回 failed（fixer.abort / PTY 异常）。
   * 仅当任务处于 fixing 时生效。
   */
  revertFix(taskId: string): boolean {
    if (this.states[taskId] !== 'fixing') return false;
    this.applyTransition(taskId, 'fail');
    return true;
  }

  /**
   * 返回任务的失败修复上下文（本 run 内失败时记录）。
   * 无上下文（未失败 / 未在本 run 内）返回 null —— fixer 据此拒绝修复。
   */
  failureContext(taskId: string): FailureContext | null {
    return this.failureContexts.get(taskId) ?? null;
  }

  /** 返回 manifest 中任务定义（标题、描述、claude_hint 等元数据）。 */
  taskDef(taskId: string): TaskManifest['tasks'][number] | undefined {
    return this.manifest.tasks.find((t) => t.id === taskId);
  }

  /**
   * Stop the run: abort the in-flight command, reset un-started tasks to
   * pending and clear the queue. Safe to call while awaiting a decision
   * (resolves it as 'stop') or while idle (no-op).
   */
  stop(): void {
    this.stopRequested = true;
    if (this.awaitingDecision !== null) {
      this.decisionWaiter?.resolve('stop');
      return;
    }
    if (this.running) this.abortController?.abort();
  }

  /** Execution snapshot for reconnection state resync. */
  snapshot(): RunnerSnapshot {
    return {
      states: { ...this.states },
      queue: [...this.queue],
      currentTask: this.currentTask,
      awaitingDecision: this.awaitingDecision,
      running: this.running,
      total: this.total,
      completed: this.completed,
    };
  }

  /**
   * State captured when a run was stopped (queue and statuses as they were
   * before the queue reset). Useful for reconnect resync and tests.
   */
  get stoppedState(): RunnerSnapshot | null {
    return this._stopCapture;
  }

  // -- Internals ------------------------------------------------------------

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 && !this.stopRequested) {
      const taskId = this.queue[0];
      this.currentTask = taskId;
      this.awaitingDecision = null;

      const outcome = await this.executeTask(taskId);
      if (this.stopRequested) {
        this.captureStopped();
        break;
      }

      if (outcome === 'success') {
        this.queue.shift();
        this.currentTask = null;
        this.emitProgress();
        continue;
      }

      // Failed → park here and wait for the user's decision.
      this.awaitingDecision = taskId;
      const decision = await this.waitForDecision();
      this.awaitingDecision = null;
      if (this.stopRequested || decision === 'stop') {
        this.captureStopped();
        break;
      }

      if (decision === 'retry') {
        continue; // re-run the head of the queue (failed --start--> running)
      }

      // decision === 'skip'
      this.applyTransition(taskId, 'skip');
      this.queue.shift();
      this.currentTask = null;
      this.emitProgress();
    }
  }

  private async executeTask(taskId: string): Promise<'success' | 'failed'> {
    const task = this.manifest.tasks.find((t) => t.id === taskId);
    if (!task) {
      // Defensive: run() validates selections up front, so this is unreachable
      // through normal flow.
      this.states[taskId] = 'failed';
      this.emit('task-state', taskId, 'failed');
      this.log(taskId, 'stderr', `未知任务 id: ${taskId}`);
      this.recordFailure(taskId, 'command:0', '');
      return 'failed';
    }

    this.applyTransition(taskId, 'start');

    // -- 1. files upload ----------------------------------------------------
    if (task.files.length > 0) {
      for (const file of task.files) {
        if (this.abortSignal().aborted) {
          this.applyTransition(taskId, 'fail');
          return 'failed';
        }
        const remotePath = `${this.remoteRoot}/${file}`;
        try {
          await this.uploader.upload(file, remotePath);
        } catch (err) {
          this.log(taskId, 'stderr', `文件上传失败（${file}）: ${(err as Error).message}`);
          this.applyTransition(taskId, 'fail');
          this.recordFailure(taskId, 'upload', file);
          return 'failed';
        }
      }
    }

    // -- 2. commands --------------------------------------------------------
    for (let idx = 0; idx < task.commands.length; idx++) {
      const cmd = task.commands[idx];
      if (this.abortSignal().aborted) {
        this.applyTransition(taskId, 'fail');
        return 'failed';
      }
      let result: ExecResult;
      try {
        result = await this.executor.exec(cmd, {
          onOutput: (chunk) => this.log(taskId, chunk.stream, chunk.data),
          signal: this.abortSignal(),
        });
      } catch (err) {
        if (this.abortSignal().aborted) {
          this.applyTransition(taskId, 'fail');
          return 'failed';
        }
        this.log(taskId, 'stderr', `命令执行失败: ${(err as Error).message}（命令: ${cmd}）`);
        this.applyTransition(taskId, 'fail');
        this.recordFailure(taskId, `command:${idx + 1}`, cmd);
        return 'failed';
      }
      if (this.abortSignal().aborted) {
        this.applyTransition(taskId, 'fail');
        return 'failed';
      }
      if (result.code !== 0) {
        this.log(taskId, 'stderr', `命令退出码非 0（${result.code}）: ${cmd}`);
        this.applyTransition(taskId, 'fail');
        this.recordFailure(taskId, `command:${idx + 1}`, cmd);
        return 'failed';
      }
    }

    // -- 3. verify ----------------------------------------------------------
    if (task.verify) {
      if (this.abortSignal().aborted) {
        this.applyTransition(taskId, 'fail');
        return 'failed';
      }
      let result: ExecResult;
      try {
        result = await this.executor.exec(task.verify, {
          onOutput: (chunk) => this.log(taskId, chunk.stream, chunk.data),
          signal: this.abortSignal(),
        });
      } catch (err) {
        if (this.abortSignal().aborted) {
          this.applyTransition(taskId, 'fail');
          return 'failed';
        }
        this.log(taskId, 'stderr', `verify 执行失败: ${(err as Error).message}`);
        this.applyTransition(taskId, 'fail');
        this.recordFailure(taskId, 'verify', task.verify);
        return 'failed';
      }
      if (this.abortSignal().aborted) {
        this.applyTransition(taskId, 'fail');
        return 'failed';
      }
      if (result.code !== 0) {
        this.log(taskId, 'stderr', `verify 命令退出码非 0（${result.code}）: ${task.verify}`);
        this.applyTransition(taskId, 'fail');
        this.recordFailure(taskId, 'verify', task.verify);
        return 'failed';
      }
    }

    this.applyTransition(taskId, 'succeed');
    return 'success';
  }

  private waitForDecision(): Promise<'retry' | 'skip' | 'stop'> {
    return new Promise((resolve) => {
      this.decisionWaiter = { resolve };
    });
  }

  private captureStopped(): void {
    this._stopCapture = {
      states: { ...this.states },
      queue: [...this.queue],
      currentTask: this.currentTask,
      awaitingDecision: this.awaitingDecision,
      running: true,
      total: this.total,
      completed: this.completed,
    };
    this.emit('stopped-state', this._stopCapture);
  }

  private applyTransition(taskId: string, event: TaskEvent): void {
    const current = this.states[taskId] ?? 'pending';
    const next = transition(current, event);
    if (next === null) {
      throw new Error(`非法状态转移: ${taskId} ${current} --${event}-> ?`);
    }
    if (next === current) return;
    this.states[taskId] = next;
    this.emit('task-state', taskId, next);
  }

  private abortSignal(): AbortSignal {
    return this.abortController!.signal;
  }

  private emitProgress(): void {
    this.emit('progress', this.completed, this.total);
  }

  private log(taskId: string, stream: StreamTag, data: string): void {
    this.emit('log', { taskId, stream, data });
    // 滚动输出尾部：保留最近 16KB 供修复提示词的错误输出截取。
    const prev = this.outputTails.get(taskId) ?? '';
    const next = prev + data;
    const cap = TaskRunner.OUTPUT_TAIL_CAP;
    this.outputTails.set(taskId, next.length > cap ? next.slice(-cap) : next);
  }

  private recordFailure(taskId: string, stage: string, command: string): void {
    this.failureContexts.set(taskId, {
      taskId,
      stage,
      command,
      errorTail: this.outputTails.get(taskId) ?? '',
    });
  }
}

// ---------------------------------------------------------------------------
//  Real adapter: SshSftp → FileUploader
// ---------------------------------------------------------------------------

/**
 * Adapt SshSftp into the FileUploader seam. Declared `files` are relative to
 * `filesRoot` (absolute paths pass through). Directories upload recursively.
 */
export function createSftpUploader(sftp: SshSftp, filesRoot: string): FileUploader {
  return {
    async upload(localPath: string, remotePath: string): Promise<void> {
      const abs = isAbsolute(localPath) ? localPath : join(filesRoot, localPath);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await sftp.uploadDir(abs, remotePath);
      } else {
        await sftp.uploadFile(abs, remotePath);
      }
    },
  };
}
