/**
 * server/engine/runner.integration.test.ts
 *
 * Integration tests for TaskRunner against the fenix-sshd-test container
 * (ubuntu:24.04 with openssh-server on 127.0.0.1:2222).
 *
 * Requires:
 *   docker compose -f docker-compose.test.yml up --build -d
 *   SSH_PASSWORD=<pw> npm run test
 *
 * Covers:
 *   - full success flow: real SFTP upload + real command exec + real verify
 *   - intentional failure: fail-stop-skip decision against real exec
 *   - fail-stop-retry: a command that fails once then recovers on retry
 *   - stop mid-execution: abort signal propagation to the real SSH channel
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ssh2';
import { SshConnection } from '../ssh/connection.js';
import { SshExecutor } from '../ssh/executor.js';
import { SshSftp } from '../ssh/sftp.js';
import { TaskRunner, createSftpUploader, type TaskStatus } from './runner.js';
import type { TaskManifest } from '../../shared/schema.js';

// ---------------------------------------------------------------------------
//  Container bootstrap (reuse pattern from sftp.test.ts)
// ---------------------------------------------------------------------------

const HOST = process.env.SSH_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SSH_PORT ?? 2222);
const USER = 'root';
const PASSWORD = process.env.SSH_PASSWORD ?? 'testpass123';

let conn: SshConnection;
let remoteBase: string;
let localFilesRoot: string;
let localDir: string;

beforeAll(async (ctx) => {
  // Quick connectivity probe — skip the suite if the container is down.
  const c = new Client();
  const up = await new Promise<boolean>((resolve) => {
    c.once('ready', () => { c.end(); resolve(true); });
    c.once('error', () => resolve(false));
    c.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 5_000 });
  });
  if (!up) { ctx.skip(); return; }

  conn = new SshConnection({ host: HOST, port: PORT, username: USER, password: PASSWORD });
  await conn.connect();
  localDir = await mkdtemp(join(tmpdir(), 'runner-integ-'));
  localFilesRoot = join(localDir, 'assets');
  await mkdir(localFilesRoot, { recursive: true });
  remoteBase = `/root/runner-integ-${Date.now()}`;
}, 15_000);

afterAll(async () => {
  if (conn?.state === 'ready') {
    const executor = new SshExecutor(conn);
    // 清理测试残留：远端 sleep 进程与上传目录
    await executor.exec(`pkill -9 -f 'sleep 9999' || true`).catch(() => {});
    await executor.exec(`rm -rf ${remoteBase}`).catch(() => {});
  }
  conn?.close();
  if (localDir) await rm(localDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function makeManifest(tasks: TaskManifest['tasks']): TaskManifest {
  return { meta: { name: 'integ', version: '1' }, tasks };
}

function makeTask(id: string, overrides: Partial<TaskManifest['tasks'][number]> = {}): TaskManifest['tasks'][number] {
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

function buildRunner(manifest: TaskManifest) {
  const executor = new SshExecutor(conn);
  const uploader = createSftpUploader(new SshSftp(conn), localFilesRoot);
  return new TaskRunner({ manifest, executor, uploader, remoteRoot: remoteBase, filesRoot: localFilesRoot });
}

function readFileOnRemote(relPath: string): Promise<string> {
  return new SshExecutor(conn).exec(`cat ${remoteBase}/${relPath}`).then((r) => r.stdout);
}

/** Wait until the runner parks on `taskId` (failed → awaiting decision). */
async function waitForAwaitingDecision(runner: TaskRunner, taskId: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(runner.snapshot().awaitingDecision).toBe(taskId);
    },
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe('TaskRunner 集成测试 (ubuntu:24.04 sshd)', () => {
  it('完整任务成功流转：文件上传后命令执行、verify 真实生效', async () => {
    // Fixture files
    const subDir = join(localFilesRoot, 'sub');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(localFilesRoot, 'test-file.txt'), 'hello from local');
    await writeFile(join(subDir, 'deep.txt'), 'deep content');

    const manifest = makeManifest([
      makeTask('upload-files', {
        files: ['test-file.txt', 'sub/deep.txt'],
        commands: ['echo upload-step-done'],
        verify: `test -f ${remoteBase}/test-file.txt && test -f ${remoteBase}/sub/deep.txt`,
      }),
    ]);

    const runner = buildRunner(manifest);
    await runner.run(['upload-files']);

    const snap = runner.snapshot();
    expect(snap.states['upload-files']).toBe('success');
    expect(snap.completed).toBe(1);
    expect(snap.total).toBe(1);

    // 文件真的出现在远端
    expect(await readFileOnRemote('test-file.txt')).toBe('hello from local');
    expect(await readFileOnRemote('sub/deep.txt')).toBe('deep content');
  });

  it('故意失败命令触发停等：失败决策后可 skip 继续后续任务', async () => {
    const manifest = makeManifest([
      makeTask('a-ok', { commands: ['echo ok'] }),
      makeTask('b-fail', { commands: ['echo about-to-fail && exit 1'] }),
      makeTask('c-ok', { commands: ['echo still-runs'] }),
    ]);

    const runner = buildRunner(manifest);
    const events: Array<{ type: string; taskId?: string; status?: TaskStatus; reason?: string }> = [];
    runner.on('task-state', (taskId: string, status: TaskStatus) =>
      events.push({ type: 'task-state', taskId, status }));
    runner.on('queue-finished', (info: { reason: string }) =>
      events.push({ type: 'queue-finished', reason: info.reason }));

    const runPromise = runner.run(['a-ok', 'b-fail', 'c-ok']);
    await waitForAwaitingDecision(runner, 'b-fail');

    // B 已失败停等，C 未开始
    const midSnap = runner.snapshot();
    expect(midSnap.states['a-ok']).toBe('success');
    expect(midSnap.states['b-fail']).toBe('failed');
    expect(midSnap.states['c-ok']).toBe('pending');
    expect(midSnap.completed).toBe(1);

    runner.skip('b-fail');
    await runPromise;

    const finalSnap = runner.snapshot();
    expect(finalSnap.states['b-fail']).toBe('skipped');
    expect(finalSnap.states['c-ok']).toBe('success');
    expect(finalSnap.completed).toBe(3);
    expect(events.some((e) => e.type === 'queue-finished' && e.reason === 'completed')).toBe(true);
  });

  it('失败命令 retry 可恢复执行并继续队列', async () => {
    const marker = '/tmp/fenix-retry-marker';
    const manifest = makeManifest([
      makeTask('before', { commands: ['echo before-ok'] }),
      makeTask('retry-me', {
        // 首次执行创建标记并失败；重试时标记存在 → 删除并成功
        commands: [
          `if [ -f ${marker} ]; then rm -f ${marker}; exit 0; else touch ${marker}; exit 1; fi`,
        ],
      }),
      makeTask('after', { commands: ['echo after-ok' ] }),
    ]);

    // 清场：保证标记不存在
    await new SshExecutor(conn).exec(`rm -f ${marker}`);

    const runner = buildRunner(manifest);
    const runPromise = runner.run(['before', 'retry-me', 'after']);
    await waitForAwaitingDecision(runner, 'retry-me');
    expect(runner.snapshot().states['retry-me']).toBe('failed');

    runner.retry('retry-me');
    await runPromise;

    const snap = runner.snapshot();
    expect(snap.states['before']).toBe('success');
    expect(snap.states['retry-me']).toBe('success');
    expect(snap.states['after']).toBe('success');
  });

  it('停止中断当前命令：abort 终止 exec，未开始任务复位 pending，队列清空', async () => {
    const manifest = makeManifest([
      makeTask('ok-first', { commands: ['echo step1'] }),
      makeTask('hang', { commands: ['sleep 9999'] }),
      makeTask('never', { commands: ['echo should-not-run'] }),
    ]);

    const runner = buildRunner(manifest);
    const runPromise = runner.run(['ok-first', 'hang', 'never']);
    await vi.waitFor(
      () => {
        expect(runner.snapshot().currentTask).toBe('hang');
      },
      { timeout: 10_000 },
    );

    runner.stop();
    await runPromise;

    const snap = runner.snapshot();
    expect(snap.states['ok-first']).toBe('success');
    expect(snap.running).toBe(false);
    expect(snap.queue).toEqual([]);

    // 停止瞬间快照：hang（当前命令）被 abort → failed，未开始的 never 保持 pending，
    // 队列中仍含 hang/never（随后被清空）
    const stopped = runner.stoppedState;
    expect(stopped).not.toBeNull();
    if (stopped === null) throw new Error('stopped-state 未被捕获');
    expect(stopped.states['ok-first']).toBe('success');
    expect(stopped.states['hang']).toBe('failed');
    expect(stopped.states['never']).toBe('pending');
    expect(stopped.queue).toContain('hang');
    expect(stopped.queue).toContain('never');

    // 说明：远端 sleep 进程可能残留（设计文档 Risks 已记录：channel close
    // 语义差异，远端进程可能残留，不引入远端 pkill 复杂度）。
  });
});
