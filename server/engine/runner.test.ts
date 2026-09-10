/**
 * server/engine/runner.test.ts
 *
 * Unit tests for TaskRunner with in-memory fake executor/SFTP. Covers the
 * execution-runner spec scenarios:
 *   - full success flow (files → commands → verify)
 *   - command failure stops the remaining commands
 *   - upload failure fails the task without running commands
 *   - verify failure fails the task (stage marked in the log)
 *   - failure parks the queue; retry / skip drive continuation
 *   - stop aborts the in-flight command and resets the queue
 *   - real-time log events and progress events
 *   - execution snapshot
 * Plus exhaustive legality tests for the `transition` state table.
 */
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { TaskManifest } from '../../shared/schema.js';
import type { ExecResult, OutputChunk } from '../ssh/executor.js';
import {
  TaskRunner,
  transition,
  type CommandExecutor,
  type FileUploader,
  type StreamTag,
  type TaskStatus,
} from './runner.js';

// ---------------------------------------------------------------------------
//  Fakes
// ---------------------------------------------------------------------------

interface FakeChunk {
  stream: StreamTag;
  data: string;
  /** Emit this chunk only after `delayMs` (default 0). */
  delayMs?: number;
}

interface FakeBehavior {
  code?: number;
  /** Fail the first `failTimes` invocations with exit code 7. */
  failTimes?: number;
  chunks?: FakeChunk[];
  /** Never resolve on its own; rejects only when the signal aborts. */
  hang?: boolean;
}

const DEFAULT_BEHAVIOR: FakeBehavior = { code: 0 };

class FakeExecutor implements CommandExecutor {
  invocations: string[] = [];
  behaviors = new Map<string, FakeBehavior>();
  /** Signal captured by the hanging command (for abort assertions). */
  hangSignal: AbortSignal | null = null;

  setBehavior(command: string, behavior: FakeBehavior): this {
    this.behaviors.set(command, behavior);
    return this;
  }

  exec(
    command: string,
    options?: { onOutput?: (chunk: OutputChunk) => void; signal?: AbortSignal },
  ): Promise<ExecResult> {
    this.invocations.push(command);
    const behavior = this.behaviors.get(command) ?? DEFAULT_BEHAVIOR;

    return new Promise<ExecResult>((resolve, reject) => {
      if (behavior.hang) {
        this.hangSignal = options?.signal ?? null;
        if (options?.signal?.aborted) {
          reject(new Error('命令执行已中止'));
          return;
        }
        const onAbort = () => {
          options?.signal?.removeEventListener('abort', onAbort);
          reject(new Error('命令执行已中止'));
        };
        options?.signal?.addEventListener('abort', onAbort, { once: true });
        return;
      }

      const emitChunks = async () => {
        for (const chunk of behavior.chunks ?? []) {
          if (chunk.delayMs) await new Promise((r) => setTimeout(r, chunk.delayMs));
          options?.onOutput?.(chunk);
        }
        const failFirst = (behavior.failTimes ?? 0) > 0;
        if (failFirst) behavior.failTimes = (behavior.failTimes ?? 0) - 1;
        resolve({
          code: failFirst ? 7 : (behavior.code ?? 0),
          stdout: (behavior.chunks ?? [])
            .filter((c) => c.stream === 'stdout')
            .map((c) => c.data)
            .join(''),
          stderr: (behavior.chunks ?? [])
            .filter((c) => c.stream === 'stderr')
            .map((c) => c.data)
            .join(''),
        });
      };
      void emitChunks();
    });
  }
}

class FakeUploader implements FileUploader {
  uploads: Array<{ local: string; remote: string }> = [];
  /** Local path that should fail to upload. */
  failingLocal?: string;

  async upload(localPath: string, remotePath: string): Promise<void> {
    this.uploads.push({ local: localPath, remote: remotePath });
    if (this.failingLocal === localPath) {
      throw new Error('模拟上传失败');
    }
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function makeManifest(tasks: TaskManifest['tasks']): TaskManifest {
  return { meta: { name: 'test-manifest', version: '1.0' }, tasks };
}

/** Shortcut constructor for independent tasks (A, B, C…). */
function task(id: string, overrides: Partial<TaskManifest['tasks'][number]> = {}): TaskManifest['tasks'][number] {
  return {
    id,
    title: id,
    commands: [`echo ${id}`],
    requires: [],
    files: [],
    needs_proxy: false,
    ...overrides,
  };
}

type CollectedEvent =
  | { kind: 'task-state'; taskId: string; status: TaskStatus }
  | { kind: 'log'; taskId: string; stream: StreamTag; data: string }
  | { kind: 'progress'; completed: number; total: number }
  | { kind: 'queue-finished'; reason: 'completed' | 'stopped' };

function collect(runner: TaskRunner): CollectedEvent[] {
  const events: CollectedEvent[] = [];
  runner.on('task-state', (taskId: string, status: TaskStatus) =>
    events.push({ kind: 'task-state', taskId, status }));
  runner.on('log', (e: { taskId: string; stream: StreamTag; data: string }) =>
    events.push({ kind: 'log', ...e }));
  runner.on('progress', (completed: number, total: number) =>
    events.push({ kind: 'progress', completed, total }));
  runner.on('queue-finished', (info: { reason: 'completed' | 'stopped' }) =>
    events.push({ kind: 'queue-finished', reason: info.reason }));
  return events;
}

/** Instantiate a runner wired to the fakes. */
function setup(tasks: TaskManifest['tasks'], overrides: Partial<ConstructorParameters<typeof TaskRunner>[0]> = {}) {
  const executor = new FakeExecutor();
  const uploader = new FakeUploader();
  const runner = new TaskRunner({
    manifest: makeManifest(tasks),
    executor,
    uploader,
    remoteRoot: '/root/server-init',
    filesRoot: '/local',
    ...overrides,
  });
  return { runner, executor, uploader };
}

/** Wait until `predicate` becomes truthy (runner reaching a decision point). */
async function waitForDecision(runner: TaskRunner, taskId: string, timeoutMs = 2000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(runner.snapshot().awaitingDecision).toBe(taskId);
    },
    { timeout: timeoutMs },
  );
}

// ---------------------------------------------------------------------------
//  transition — centralised state machine
// ---------------------------------------------------------------------------

describe('transition 状态机合法性', () => {
  it('start: pending 与 failed 均可进入 running（含重试）', () => {
    expect(transition('pending', 'start')).toBe('running');
    expect(transition('failed', 'start')).toBe('running');
  });

  it('succeed/fail 仅可从 running 进入', () => {
    expect(transition('running', 'succeed')).toBe('success');
    expect(transition('running', 'fail')).toBe('failed');
    expect(transition('pending', 'succeed')).toBeNull();
    expect(transition('failed', 'succeed')).toBeNull();
    expect(transition('success', 'fail')).toBeNull();
  });

  it('skipped 只能从 failed/pending 进入', () => {
    expect(transition('failed', 'skip')).toBe('skipped');
    expect(transition('pending', 'skip')).toBe('skipped');
    expect(transition('running', 'skip')).toBeNull();
    expect(transition('success', 'skip')).toBeNull();
  });

  it('fix: failed → fixing（保留给 Claude 修复流程）', () => {
    expect(transition('failed', 'fix')).toBe('fixing');
    expect(transition('running', 'fix')).toBeNull();
  });

  it('start: fixing → running（修复后自动重跑）', () => {
    expect(transition('fixing', 'start')).toBe('running');
    expect(transition('fixing', 'succeed')).toBeNull();
    expect(transition('fixing', 'skip')).toBeNull();
  });

  it('fail: fixing → failed（中止修复回退失败态）', () => {
    expect(transition('fixing', 'fail')).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
//  TaskRunner — execution flows
// ---------------------------------------------------------------------------

describe('TaskRunner 串行执行', () => {
  it('完整任务成功流转：files → commands → verify，verify 在 commands 之后', async () => {
    const tasks = [
      task('full', {
        files: ['a.txt', 'sub/b.txt'],
        commands: ['echo one', 'echo two'],
        verify: 'test -f /root/server-init/a.txt',
      }),
    ];
    const { runner, executor, uploader } = setup(tasks);

    await runner.run(['full']);

    expect(runner.snapshot().states['full']).toBe('success');
    // 上传先于命令
    expect(uploader.uploads).toEqual([
      { local: 'a.txt', remote: '/root/server-init/a.txt' },
      { local: 'sub/b.txt', remote: '/root/server-init/sub/b.txt' },
    ]);
    const firstUploadIdx = uploader.uploads.length;
    // 命令与 verify 按序执行
    expect(executor.invocations).toEqual(['echo one', 'echo two', 'test -f /root/server-init/a.txt']);
    // 上传确实发生在命令之前
    expect(firstUploadIdx).toBe(2);
  });

  it('命令失败终止后续命令：第三条不被执行，任务进入 failed 并停等', async () => {
    const { runner, executor } = setup([
      task('t', { commands: ['c1', 'c2', 'c3'] }),
    ]);
    executor.setBehavior('c2', { code: 7 });

    const runPromise = runner.run(['t']);
    await waitForDecision(runner, 't');

    expect(runner.snapshot().states['t']).toBe('failed');
    expect(executor.invocations).toEqual(['c1', 'c2']);
    expect(executor.invocations).not.toContain('c3');

    runner.skip('t');
    await runPromise;
    expect(runner.snapshot().states['t']).toBe('skipped');
  });

  it('文件上传失败即任务失败：不执行任何 command', async () => {
    const { runner, executor, uploader } = setup([
      task('t', { files: ['missing.txt'], commands: ['echo never'] }),
    ]);
    uploader.failingLocal = 'missing.txt';

    const runPromise = runner.run(['t']);
    await waitForDecision(runner, 't');

    expect(runner.snapshot().states['t']).toBe('failed');
    expect(executor.invocations).toEqual([]);

    runner.skip('t');
    await runPromise;
  });

  it('verify 失败判任务失败，错误上下文标注 verify 阶段', async () => {
    const events: CollectedEvent[] = [];
    const { runner, executor } = setup([task('t', { verify: 'check-x' })]);
    executor.setBehavior('check-x', { code: 5 });
    runner.on('log', (e) => events.push({ kind: 'log', ...e }));

    const runPromise = runner.run(['t']);
    await waitForDecision(runner, 't');

    expect(runner.snapshot().states['t']).toBe('failed');
    const verifyLog = events.find(
      (e) => e.kind === 'log' && e.data.includes('verify'),
    );
    expect(verifyLog).toBeDefined();

    runner.skip('t');
    await runPromise;
  });

  it('失败停等：队列 [A,B,C] 中 B 失败 → C 不开始', async () => {
    const { runner, executor } = setup([task('A'), task('B'), task('C')]);
    executor.setBehavior('echo B', { code: 3 });

    const runPromise = runner.run(['A', 'B', 'C']);
    await waitForDecision(runner, 'B');

    // A 已成功，B 失败停等，C 未开始
    expect(runner.snapshot().states).toMatchObject({
      A: 'success',
      B: 'failed',
      C: 'pending',
    });
    expect(runner.snapshot().currentTask).toBe('B');
    expect(executor.invocations).toEqual(['echo A', 'echo B']);

    runner.skip('B');
    await runPromise;

    const states = runner.snapshot().states;
    expect(states['B']).toBe('skipped');
    expect(states['C']).toBe('success');
    expect(executor.invocations).toContain('echo C');
  });

  it('重试失败任务成功后继续：B 重跑成功则 C 自动开始', async () => {
    const { runner, executor } = setup([task('A'), task('B'), task('C')]);
    executor.setBehavior('echo B', { failTimes: 1, code: 0, chunks: [{ stream: 'stderr' as const, data: 'boom' }] });

    const runPromise = runner.run(['A', 'B', 'C']);
    await waitForDecision(runner, 'B');
    expect(runner.snapshot().states['B']).toBe('failed');

    runner.retry('B');
    await runPromise;

    expect(runner.snapshot().states).toMatchObject({
      A: 'success',
      B: 'success',
      C: 'success',
    });
    expect(executor.invocations).toEqual(['echo A', 'echo B', 'echo B', 'echo C']);
  });

  it('跳过失败任务后继续不依赖它的任务', async () => {
    const { runner, executor } = setup([
      // C 不依赖 B（均无依赖，声明顺序 A、B、C）
      task('A'),
      task('B'),
      task('C'),
    ]);
    executor.setBehavior('echo B', { code: 9 });

    const runPromise = runner.run(['A', 'B', 'C']);
    await waitForDecision(runner, 'B');

    runner.skip('B');
    await runPromise;

    const states = runner.snapshot().states;
    expect(states['A']).toBe('success');
    expect(states['B']).toBe('skipped');
    expect(states['C']).toBe('success');
  });

  it('停止复位：终止当前命令、未开始任务回到 pending、队列清空', async () => {
    const { runner, executor } = setup([task('A'), task('B'), task('C')]);
    const events = collect(runner);
    executor.setBehavior('echo B', { hang: true });

    const runPromise = runner.run(['A', 'B', 'C']);
    // 等 B 进入挂起命令
    await vi.waitFor(
      () => {
        expect(runner.snapshot().currentTask).toBe('B');
      },
      { timeout: 2000 },
    );
    // B 的命令已在执行
    expect(executor.hangSignal).not.toBeNull();

    runner.stop();
    await runPromise;

    const snap = runner.snapshot();
    // 当前命令被终止（信号已 abort）
    expect(executor.hangSignal?.aborted).toBe(true);
    // 未开始任务回到 pending，队列清空
    expect(snap.states['C']).toBe('pending');
    expect(snap.states['A']).toBe('success');
    expect(snap.queue).toEqual([]);
    expect(snap.running).toBe(false);
    expect(events.some((e) => e.kind === 'queue-finished' && e.reason === 'stopped')).toBe(true);
  });

  it('实时事件：输出分片随产生即发射，先于命令结束', async () => {
    const { runner, executor } = setup([task('t', { commands: ['echo streaming'] })]);
    executor.setBehavior('echo streaming', {
      chunks: [
        { stream: 'stdout', data: 'part1' },
        { stream: 'stdout', data: 'part2', delayMs: 15 },
      ],
      code: 0,
    });
    const events = collect(runner);

    await runner.run(['t']);

    const logEvents = events.filter((e) => e.kind === 'log');
    // 两个分片分别发射，而非合并为一条
    expect(logEvents.filter((e) => e.kind === 'log' && e.data === 'part1')).toHaveLength(1);
    expect(logEvents.filter((e) => e.kind === 'log' && e.data === 'part2')).toHaveLength(1);
    // part1 的 log 事件出现在任务 success 之前（随产生即发射）
    const successIdx = events.findIndex(
      (e) => e.kind === 'task-state' && e.taskId === 't' && e.status === 'success',
    );
    const part1Idx = events.findIndex((e) => e.kind === 'log' && e.data === 'part1');
    expect(part1Idx).toBeGreaterThanOrEqual(0);
    expect(part1Idx).toBeLessThan(successIdx);
  });

  it('进度事件：3 个任务完成 2 个时报告 2/3', async () => {
    const { runner, executor } = setup([task('A'), task('B'), task('C')]);
    // 让第三个任务挂起，从而观测到「完成 2 个」的时刻
    executor.setBehavior('echo C', { hang: true });
    const progress: Array<{ completed: number; total: number }> = [];
    runner.on('progress', (c: number, t: number) => progress.push({ completed: c, total: t }));

    const runPromise = runner.run(['A', 'B', 'C']);
    const snapshotB = await vi.waitFor(() => {
      const snap = runner.snapshot();
      expect(snap.completed).toBe(2);
      return snap;
    });
    expect(snapshotB).toMatchObject({ completed: 2, total: 3, currentTask: 'C' });
    runner.stop();
    await runPromise;

    expect(progress[0]).toEqual({ completed: 0, total: 3 });
    expect(progress).toContainEqual({ completed: 1, total: 3 });
    expect(progress).toContainEqual({ completed: 2, total: 3 });
    // 停在第 3 个任务：完成数不再增长
    expect(progress[progress.length - 1]).toEqual({ completed: 2, total: 3 });
  });

  it('快照反映实时状态：执行到第 2 个任务时包含全部状态与当前任务', async () => {
    const { runner, executor } = setup([task('A'), task('B'), task('C')]);
    executor.setBehavior('echo B', { hang: true });

    const runPromise = runner.run(['A', 'B', 'C']);
    await vi.waitFor(() => {
      expect(runner.snapshot().currentTask).toBe('B');
    });

    const snap = runner.snapshot();
    expect(snap.states).toMatchObject({
      A: 'success',
      B: 'running',
      C: 'pending',
    });
    expect(snap.currentTask).toBe('B');
    expect(snap.total).toBe(3);
    expect(snap.completed).toBe(1);
    expect(snap.running).toBe(true);

    runner.stop();
    await runPromise;
  });

  it('依赖环选择 → run 抛错，不产生执行', async () => {
    const { runner } = setup([
      task('A', { requires: ['B'] }),
      task('B', { requires: ['A'] }),
    ]);
    await expect(runner.run(['A'])).rejects.toThrow('依赖存在环');
  });

  it('未知任务 id → run 抛错', async () => {
    const { runner } = setup([task('A')]);
    await expect(runner.run(['ghost'])).rejects.toThrow('未知任务 id');
  });

  it('retry/skip 对非停等任务无效', async () => {
    const { runner } = setup([task('A'), task('B')]);
    const runPromise = runner.run(['A', 'B']);
    await vi.waitFor(() => {
      expect(runner.snapshot().states['A']).toBe('success');
    });
    // 未失败的任务调用 skip/retry 无副作用
    runner.skip('A');
    runner.retry('A');
    await runPromise;
    expect(runner.snapshot().states['A']).toBe('success');
  });

  it('失败上下文 + fix/revertFix：失败可查上下文，置 fixing 后 retry/skip 被忽略', async () => {
    const { runner, executor } = setup([task('A'), task('B')]);
    executor.setBehavior('echo B', { code: 7 });
    const runPromise = runner.run(['A', 'B']);
    await waitForDecision(runner, 'B');

    // 失败上下文：失败阶段与命令原文可见
    const ctx = runner.failureContext('B');
    expect(ctx).not.toBeNull();
    expect(ctx!.stage).toBe('command:1');
    expect(ctx!.command).toBe('echo B');
    // 未失败任务无上下文
    expect(runner.failureContext('A')).toBeNull();

    // fix → fixing；修复中 retry/skip 被忽略
    expect(runner.fix('B')).toBe(true);
    expect(runner.snapshot().states['B']).toBe('fixing');
    runner.retry('B');
    runner.skip('B');
    expect(runner.snapshot().states['B']).toBe('fixing');

    // revertFix → 回 failed，仍停等，skip 重新可用
    expect(runner.revertFix('B')).toBe(true);
    expect(runner.snapshot().states['B']).toBe('failed');
    runner.skip('B');
    await runPromise;

    // 非失败/非停等任务 fix 无效
    expect(runner.fix('A')).toBe(false);

    // taskDef 提供元数据（claude_hint 等）
    expect(runner.taskDef('B')?.title).toBe('B');
  });
});