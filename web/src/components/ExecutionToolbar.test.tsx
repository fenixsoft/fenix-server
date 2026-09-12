/**
 * web/src/components/ExecutionToolbar.test.tsx
 *
 * 执行工具栏测试（execution-navigation SPEC）：
 *   - 「执行全部」按钮存在；未连接/执行中时禁用
 *   - 点击「执行全部」→ 全任务过滤 success 后入队
 *   - 「全部重跑」开关 → store.rerunAll 置位；再点执行全部 → 纳入 success 并携带 rerun:true
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../stores/appStore';
import { wsClient } from '../wsClient';
import ExecutionToolbar from './ExecutionToolbar';
import type { ClientMessage } from '@fenix/shared/messages';

const MANIFEST = {
  meta: { name: 't', version: 1 },
  tasks: [
    { id: 'A', title: '任务A', commands: ['echo a'], needs_proxy: false, requires: [], files: [] },
    { id: 'B', title: '任务B', commands: ['echo b'], needs_proxy: false, requires: ['A'], files: [] },
  ],
};

const execAllButton = () => screen.getByRole('button', { name: /执行全部/ }) as HTMLButtonElement;
const rerunSwitch = () => screen.getByRole('switch') as HTMLButtonElement;

beforeEach(() => {
  useAppStore.setState({
    manifest: MANIFEST as never,
    taskStates: { A: 'pending', B: 'pending' },
    selected: [],
    progress: { completed: 0, total: 0 },
    sshStatus: 'ready',
    rerunAll: false,
  });
  vi.restoreAllMocks();
});

afterEach(() => { cleanup(); });

describe('ExecutionToolbar', () => {
  it('渲染「执行全部」按钮与「全部重跑」开关', () => {
    render(<ExecutionToolbar />);
    expect(execAllButton()).toBeTruthy();
    expect(rerunSwitch()).toBeTruthy();
  });

  it('未连接时「执行全部」禁用', () => {
    useAppStore.setState({ sshStatus: 'disconnected' });
    render(<ExecutionToolbar />);
    expect(execAllButton().disabled).toBe(true);
  });

  it('执行中「执行全部」禁用（防重复触发）', () => {
    useAppStore.setState({ taskStates: { A: 'running', B: 'pending' } });
    render(<ExecutionToolbar />);
    expect(execAllButton().disabled).toBe(true);
  });

  it('点击「执行全部」→ 全任务闭包入队，已 success 任务跳过（无 rerun 标记）', async () => {
    useAppStore.setState({ taskStates: { A: 'success', B: 'pending' } });
    const spy = vi.spyOn(wsClient, 'send');
    const user = userEvent.setup();
    render(<ExecutionToolbar />);

    await user.click(execAllButton());

    const sent = spy.mock.calls[0]?.[0] as ClientMessage & { payload: { taskIds: string[]; rerun?: boolean } };
    expect(sent.type).toBe('exec');
    expect(sent.payload.taskIds).toEqual(['B']); // A 已 success → 跳过
    expect(sent.payload.rerun).toBeUndefined();
  });

  it('开启「全部重跑」→ store.rerunAll 置 true；再点执行全部 → 纳入 success 并携带 rerun:true', async () => {
    useAppStore.setState({ taskStates: { A: 'success', B: 'pending' } });
    const spy = vi.spyOn(wsClient, 'send');
    const user = userEvent.setup();
    render(<ExecutionToolbar />);

    await user.click(rerunSwitch());
    expect(useAppStore.getState().rerunAll).toBe(true);

    await user.click(execAllButton());
    const sent = spy.mock.calls[0]?.[0] as ClientMessage & { payload: { taskIds: string[]; rerun?: boolean } };
    expect(sent.payload.taskIds).toEqual(['A', 'B']);
    expect(sent.payload.rerun).toBe(true);
  });
});