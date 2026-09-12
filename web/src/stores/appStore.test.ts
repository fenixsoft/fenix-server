/**
 * web/src/stores/appStore.test.ts
 *
 * Store slice behaviour: manifest loading (builtin/custom), cascade
 * selection with blocked grey-out, message reduction (connection-status,
 * task-state, progress, log ring buffer, tunnel-status), and the ring-buffer
 * cap. Runs under jsdom (localStorage used by the servers slice).
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { useAppStore, LOG_RING_LIMIT } from './appStore';
import { wsClient } from '../wsClient';
import { parseTaskManifest, type TaskManifest } from '@fenix/shared/schema';
import type { ServerMessage, ClientMessage } from '@fenix/shared/messages';

// ---------------------------------------------------------------------------
//  Fixtures
// ---------------------------------------------------------------------------

const TASKS = [
  {
    id: 'A',
    title: 'A',
    group: 'G1',
    commands: ['echo a'],
  },
  {
    id: 'B',
    title: 'B',
    group: 'G1',
    commands: ['echo b'],
    requires: ['A'],
  },
  {
    id: 'C',
    title: 'C',
    group: 'G2',
    commands: ['echo c'],
    requires: ['B'],
  },
];

const CUSTOM_YAML = `
meta:
  name: custom
  version: 1
tasks:
  - id: t1
    title: 任务一
    commands:
      - echo 1
  - id: t2
    title: 任务二
    commands:
      - echo 2
    requires: [t1]
`;

function send(msg: ServerMessage) {
  useAppStore.getState().applyServerMessage(msg);
}

beforeEach(() => {
  // Reset the store to a clean state before every test.
  useAppStore.setState({
    manifest: null,
    manifestSource: 'builtin',
    selected: [],
    taskStates: {},
    progress: { completed: 0, total: 0 },
    currentTaskId: null,
    currentTaskTitle: null,
    awaitingDecision: null,
    logLines: [],
    claudeOutput: '',
    runStartedAt: null,
    tunnel: null,
    tunnelTestResult: null,
    sshStatus: 'disconnected',
    sshMessage: null,
    host: null,
    username: null,
    port: null,
    lastError: null,
    wsStatus: 'closed',
    servers: [],
  });
  window.localStorage.clear();
});

describe('manifest loading', () => {
  it('loadBuiltinManifest 填充内置清单并初始化全部状态为 pending', () => {
    const store = useAppStore.getState();
    store.loadBuiltinManifest();

    const s = useAppStore.getState();
    expect(s.manifest).not.toBeNull();
    expect(s.manifestSource).toBe('builtin');
    expect(Object.keys(s.taskStates).length).toBe(s.manifest!.tasks.length);
    expect(Object.values(s.taskStates).every((v) => v === 'pending')).toBe(true);
    expect(s.selected).toEqual([]);
  });

  it('loadCustomManifest 解析合法 YAML 并应用默认值', () => {
    const store = useAppStore.getState();
    const result = store.loadCustomManifest(CUSTOM_YAML);

    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.manifestSource).toBe('custom');
    expect(s.manifest!.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    // requires 默认值为空数组（zod default 填充）
    expect(s.manifest!.tasks[0].requires).toEqual([]);
  });

  it('loadCustomManifest 非法 YAML 返回结构化错误', () => {
    const store = useAppStore.getState();
    const result = store.loadCustomManifest('tasks: [unclosed');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('YAML');
  });

  it('loadCustomManifest 违反 schema 返回校验错误', () => {
    const store = useAppStore.getState();
    const bad = `
meta: { name: m, version: 1 }
tasks:
  - id: t1
    title: ""
    commands: []
`;
    const result = store.loadCustomManifest(bad);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tasks\.t1/);
  });
});

describe('cascade selection & blocking', () => {
  beforeEach(() => {
    useAppStore.getState().loadBuiltinManifest();
    // Replace with the tiny fixture graph (A ← B ← C).
    useAppStore.setState({
      manifest: { meta: { name: 't', version: 1 }, tasks: TASKS as never },
      taskStates: { A: 'pending', B: 'pending', C: 'pending' },
    });
  });

  it('勾选链末端任务 C：仅待执行任务入选中集，已 success 依赖不进选中集（dependency-rerun-fix）', () => {
    // C 依赖 B→A；A、B 均已完成 → 勾选 C 时不再级联勾选它们。
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    send({ type: 'task-state', payload: { taskId: 'B', status: 'success' } });
    useAppStore.getState().toggleTask('C');
    const selected = useAppStore.getState().selected;
    expect(selected).toEqual(['C']);
  });

  it('级联勾选过滤 success 依赖：A 已 success 时勾选 B → 选中集仅 [B]', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.getState().toggleTask('B');
    expect(useAppStore.getState().selected).toEqual(['B']);
  });

  it('取消勾选 success 依赖后不被级联被动加回（新语义）', () => {
    const store = useAppStore.getState();
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    send({ type: 'task-state', payload: { taskId: 'B', status: 'success' } });
    store.toggleTask('B'); // 显式勾选 B（允许重跑）→ A 作为 success 依赖不加回
    expect(useAppStore.getState().selected).toEqual(['B']);
    store.toggleTask('B'); // 取消 B → 选中集清空，A 不被被动加入
    expect(useAppStore.getState().selected).toEqual([]);
  });

  it('全选遵循级联与阻塞规则', () => {
    // 全部 pending 时：B 依赖 A、C 依赖 B（均未完成）→ 只有 A 可选。
    useAppStore.getState().selectAll();
    let selected = useAppStore.getState().selected;
    expect(selected).toEqual(['A']);

    // A 完成后 B 解锁；B 完成后 C 解锁，最终全选覆盖全部。
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.getState().selectAll();
    selected = useAppStore.getState().selected;
    expect(selected).toEqual(['A', 'B']);

    send({ type: 'task-state', payload: { taskId: 'B', status: 'success' } });
    useAppStore.getState().selectAll();
    selected = useAppStore.getState().selected;
    expect(selected).toEqual(['A', 'B', 'C']);
  });

  it('清空勾选', () => {
    const store = useAppStore.getState();
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    send({ type: 'task-state', payload: { taskId: 'B', status: 'success' } });
    store.toggleTask('C'); // C 依赖已成功 → 可勾选
    expect(useAppStore.getState().selected).toEqual(['C']);
    store.clearSelection();
    expect(useAppStore.getState().selected).toEqual([]);
  });

  it('直接依赖未完成时任务被阻塞不可勾选', () => {
    const store = useAppStore.getState();
    store.toggleTask('B'); // B 依赖 A，A pending → 阻塞
    expect(useAppStore.getState().selected).toEqual([]);

    // A 完成后 B 可勾选
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    store.toggleTask('B');
    expect(useAppStore.getState().selected).toContain('B');
  });
});

describe('message reduction', () => {
  beforeEach(() => {
    useAppStore.getState().loadBuiltinManifest();
    useAppStore.setState({
      manifest: { meta: { name: 't', version: 1 }, tasks: TASKS as never },
      taskStates: { A: 'pending', B: 'pending', C: 'pending' },
    });
  });

  it('connection-status 更新 SSH 状态与错误信息', () => {
    send({ type: 'connection-status', payload: { state: 'error', message: '认证失败: 密码错误' } });
    expect(useAppStore.getState().sshStatus).toBe('error');
    expect(useAppStore.getState().lastError).toContain('认证失败');
  });

  it('task-state running 打开命令分隔头并更新当前任务', () => {
    send({ type: 'task-state', payload: { taskId: 'B', status: 'running' } });

    const s = useAppStore.getState();
    expect(s.currentTaskId).toBe('B');
    const header = s.logLines.find((l) => l.kind === 'header' && l.taskId === 'B');
    expect(header?.kind).toBe('header');
    if (header?.kind === 'header') {
      expect(header.command).toBe('echo b');
      expect(header.status).toBe('running');
      expect(header.exitCode).toBeNull();
    }
  });

  it('task-state success 关闭分隔头并标注退出码 0', () => {
    send({ type: 'task-state', payload: { taskId: 'B', status: 'running' } });
    send({ type: 'task-state', payload: { taskId: 'B', status: 'success' } });

    const header = useAppStore
      .getState()
      .logLines.find((l) => l.kind === 'header' && l.taskId === 'B');
    expect(header?.kind).toBe('header');
    if (header?.kind === 'header') {
      expect(header.exitCode).toBe(0);
      expect(header.status).toBe('success');
    }
  });

  it('task-state failed 置 awaitingDecision 并从 stderr 日志解析退出码', () => {
    send({ type: 'task-state', payload: { taskId: 'B', status: 'running' } });
    send({ type: 'log', payload: { taskId: 'B', stream: 'stderr', data: '命令退出码非 0（2）: echo b' } });
    send({ type: 'task-state', payload: { taskId: 'B', status: 'failed' } });

    const s = useAppStore.getState();
    expect(s.awaitingDecision).toBe('B');
    const header = s.logLines.find((l) => l.kind === 'header' && l.taskId === 'B');
    expect(header?.kind === 'header' && header.exitCode).toBe(2);
  });

  it('log 分片按 \\n 切行，stream 标记保留', () => {
    send({ type: 'log', payload: { taskId: 'A', stream: 'stdout', data: 'line1\nline2' } });
    send({ type: 'log', payload: { taskId: 'A', stream: 'stderr', data: 'err-line' } });

    const lines = useAppStore.getState().logLines;
    expect(lines.length).toBe(3);
    expect(lines.map((l) => l.kind === 'output' ? l.data : '')).toEqual(['line1', 'line2', 'err-line']);
    const last = lines[2];
    expect(last.kind === 'output' && last.stream).toBe('stderr');
  });

  it('环形缓冲上限：超过 5000 行时丢弃最旧', () => {
    const store = useAppStore.getState();
    const chunks: ServerMessage[] = Array.from({ length: LOG_RING_LIMIT + 50 }, (_, i) => ({
      type: 'log',
      payload: { taskId: 'A', stream: 'stdout', data: `chunk-${i}` },
    }));
    for (const c of chunks) store.applyServerMessage(c);

    const lines = useAppStore.getState().logLines;
    expect(lines.length).toBe(LOG_RING_LIMIT);
    // 最旧的一批已被丢弃，最新的保留
    expect(lines[0].kind === 'output' ? lines[0].data : '').toBe('chunk-50');
    const lastLine = lines[lines.length - 1];
    expect(lastLine.kind === 'output' ? lastLine.data : '').toBe(`chunk-${LOG_RING_LIMIT + 49}`);
  });

  it('claude-output 追加到缓冲', () => {
    send({ type: 'claude-output', payload: { data: '你好，' } });
    send({ type: 'claude-output', payload: { data: '需要你的输入。' } });
    expect(useAppStore.getState().claudeOutput).toBe('你好，需要你的输入。');
  });

  it('progress 消息更新进度', () => {
    send({ type: 'progress', payload: { completed: 2, total: 3 } });
    expect(useAppStore.getState().progress).toEqual({ completed: 2, total: 3 });
  });

  it('tunnel-status 更新隧道切片', () => {
    send({ type: 'tunnel-status', payload: { open: true, remotePort: 31222 } });
    const s = useAppStore.getState();
    expect(s.tunnel).toEqual({ open: true, remotePort: 31222, message: undefined });
  });

  it('error 消息写入 lastError', () => {
    send({ type: 'error', payload: { code: 'UNREACHABLE', message: '无法连接服务器' } });
    expect(useAppStore.getState().lastError).toContain('无法连接服务器');
  });
});

describe('exec 依赖重跑语义 & 执行全部（dependency-rerun-fix / execution-navigation）', () => {
  let execSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAppStore.getState().loadBuiltinManifest();
    useAppStore.setState({
      manifest: { meta: { name: 't', version: 1 }, tasks: TASKS as never },
      taskStates: { A: 'pending', B: 'pending', C: 'pending' },
      rerunAll: false,
      selected: [],
      progress: { completed: 0, total: 0 },
    });
    vi.restoreAllMocks();
    execSpy = vi.spyOn(wsClient, 'send');
  });

  /** 返回最后一次 wsClient.send 的 ClientMessage。 */
  function lastSend() {
    const calls = execSpy.mock.calls as unknown as Array<[ClientMessage]>;
    return calls[calls.length - 1]?.[0] as { type: string; payload: { taskIds: string[]; rerun?: boolean } };
  }

  it('exec 仅重置本次队列任务：历史 success 保留，队列不含 success 依赖，无 rerun 标记', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.setState({ selected: ['B'] });

    useAppStore.getState().exec(['B']);

    const s = useAppStore.getState();
    expect(s.taskStates['A']).toBe('success'); // 历史状态保留
    expect(s.taskStates['B']).toBe('pending');
    expect(s.taskStates['C']).toBe('pending');
    expect(s.progress).toEqual({ completed: 0, total: 1 }); // 仅 B 入队
    const sent = lastSend();
    expect(sent.type).toBe('exec');
    expect(sent.payload.taskIds).toEqual(['B']);
    expect(sent.payload.rerun).toBeUndefined();
  });

  it('全部重跑开关开启 → exec 纳入已 success 任务并携带 rerun:true', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.setState({ selected: ['B'], rerunAll: true });

    useAppStore.getState().exec(['B']);

    const sent = lastSend();
    expect(sent.payload.taskIds).toEqual(['A', 'B']); // 闭包包含 success 的 A
    expect(sent.payload.rerun).toBe(true);
  });

  it('选中集全部已 success 且未开重跑 → exec 不发消息（无可执行任务）', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.setState({ selected: ['A'] });

    useAppStore.getState().exec();

    expect(execSpy).not.toHaveBeenCalled();
  });

  it('execAll（未开重跑）→ 全任务过滤 success 后入队，无 rerun 标记', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });

    useAppStore.getState().execAll();

    const sent = lastSend();
    expect(sent.payload.taskIds).toEqual(['B', 'C']); // A 已 success → 跳过
    expect(sent.payload.rerun).toBeUndefined();
    expect(useAppStore.getState().progress).toEqual({ completed: 0, total: 2 });
  });

  it('execAll（开启重跑）→ 全部任务纳入（含已 success）并携带 rerun:true', () => {
    send({ type: 'task-state', payload: { taskId: 'A', status: 'success' } });
    useAppStore.setState({ rerunAll: true });

    useAppStore.getState().execAll();

    const sent = lastSend();
    expect(sent.payload.taskIds).toEqual(['A', 'B', 'C']);
    expect(sent.payload.rerun).toBe(true);
    expect(useAppStore.getState().progress).toEqual({ completed: 0, total: 3 });
  });
});

describe('manifest 覆盖（server → client）', () => {
  /** 从真实 assets/tasks.yaml 解析服务端清单（17 任务）。 */
  function serverManifest17(): TaskManifest {
    const yamlText = readFileSync(join(process.cwd(), 'assets/tasks.yaml'), 'utf8');
    const result = parseTaskManifest(parse(yamlText));
    if (!result.ok) throw new Error('assets/tasks.yaml 校验失败');
    return result.manifest;
  }

  /** 触发 connect 前的连接态视图（模拟已选/已跑状态）。 */
  function seedConnectedState(): void {
    const store = useAppStore.getState();
    store.loadBuiltinManifest(); // 内置 10 任务代表性子集
    useAppStore.setState({
      sshStatus: 'ready',
      selected: ['setup-proxy'],
      taskStates: { 'setup-proxy': 'success' },
      progress: { completed: 1, total: 10 },
      currentTaskId: 'setup-proxy',
      currentTaskTitle: '安装 Clash 代理服务',
      awaitingDecision: null,
      focusedTaskId: 'setup-proxy',
      runStartedAt: Date.now(),
    });
    // 造两条日志 + claude 输出，验证 manifest 覆盖时清空/保留语义。
    send({ type: 'task-state', payload: { taskId: 'setup-proxy', status: 'running' } });
    send({ type: 'log', payload: { taskId: 'setup-proxy', stream: 'stdout', data: 'done' } });
    send({ type: 'claude-output', payload: { data: 'fixing...' } });
  }

  it('收到 manifest → 用服务端清单覆盖本地、重建 taskStates/勾选/进度/日志、保持连接态', () => {
    seedConnectedState();
    const serverManifest = serverManifest17();

    send({ type: 'manifest', payload: { manifest: serverManifest } });

    const s = useAppStore.getState();
    // 清单被服务端 17 任务整体替换（不再退回内置 10 任务子集）
    expect(s.manifest).toBe(serverManifest);
    expect(s.manifest!.tasks.length).toBe(17);
    // 全部状态重建为 pending
    expect(Object.keys(s.taskStates)).toHaveLength(17);
    expect(Object.values(s.taskStates).every((v) => v === 'pending')).toBe(true);
    // 勾选/进度/当前任务/详情聚焦/日志全部清空
    expect(s.selected).toEqual([]);
    expect(s.progress).toEqual({ completed: 0, total: 0 });
    expect(s.currentTaskId).toBeNull();
    expect(s.currentTaskTitle).toBeNull();
    expect(s.focusedTaskId).toBeNull();
    expect(s.logLines.every((l) => l.kind !== 'header' && l.kind !== 'output')).toBe(true);
    expect(s.logLines).toHaveLength(0);
    // 连接态保持（清单仅重建视图，不重置 ssh 连接）
    expect(s.sshStatus).toBe('ready');
    // claudeOutput 属修复终端缓冲，snapshot 补发时不主动清空
    expect(s.claudeOutput).toContain('fixing...');
  });

  it('manifest 覆盖后置灰与可选任务集按服务端 requires 推导', () => {
    seedConnectedState();
    const serverManifest = serverManifest17();
    send({ type: 'manifest', payload: { manifest: serverManifest } });

    // 全部 pending 时，仅无依赖任务可选（selectAll 尊重级联与阻塞规则）。
    useAppStore.getState().selectAll();
    const selected = useAppStore.getState().selected;
    const rootTasks = serverManifest.tasks.filter((t) => (t.requires ?? []).length === 0).map((t) => t.id);
    expect(selected.sort()).toEqual([...rootTasks].sort());
    // 有依赖任务（非无依赖集合内）均处于置灰态不可选。
    for (const t of serverManifest.tasks) {
      if (!rootTasks.includes(t.id)) expect(selected).not.toContain(t.id);
    }
  });

  it('manifest 覆盖不改变 manifestSource（用户选择的内置/自定义标识）', () => {
    seedConnectedState();
    useAppStore.setState({ manifestSource: 'custom' as const });
    send({ type: 'manifest', payload: { manifest: serverManifest17() } });
    expect(useAppStore.getState().manifestSource).toBe('custom');
  });
});

describe('server persistence (localStorage)', () => {
  it('addServer 持久化并追加到列表', () => {
    const server = { name: 'prod', host: '1.2.3.4', port: 22, username: 'root', rememberPassword: false };
    useAppStore.getState().addServer(server);

    const s = useAppStore.getState();
    expect(s.servers).toContainEqual(server);
    expect(window.localStorage.getItem('fenix.servers')).toContain('prod');
  });

  it('removeServer 从列表与存储移除', () => {
    const s = useAppStore.getState();
    s.addServer({ name: 'a', host: '1.1.1.1', port: 22, username: 'root' });
    s.addServer({ name: 'b', host: '2.2.2.2', port: 22, username: 'root' });
    useAppStore.getState().removeServer('a');

    const names = useAppStore.getState().servers.map((x) => x.name);
    expect(names).toEqual(['b']);
  });

  it('init() 从 localStorage 恢复服务器列表', () => {
    window.localStorage.setItem('fenix.servers', JSON.stringify([{ name: 'r', host: '9.9.9.9', port: 22, username: 'root' }]));
    useAppStore.setState({ servers: [] });
    useAppStore.getState().init();
    expect(useAppStore.getState().servers.map((x) => x.name)).toEqual(['r']);
  });
});
