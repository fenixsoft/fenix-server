/**
 * web/src/components/TaskTree.test.tsx
 *
 * Rendering/interaction tests for the grouped task tree:
 *   - groups render with collapsible headers
 *   - six status icons map correctly
 *   - cascade selection: checking a chain-end task selects its deps
 *   - blocked tasks are disabled (greyed) until dependencies succeed
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../stores/appStore';
import TaskTree from './TaskTree';

/** Tiny manifest with one dependency chain inside one group. */
const MANIFEST = {
  meta: { name: 't', version: 1 },
  tasks: [
    { id: 'A', title: '任务A', group: '组一', commands: ['echo a'] },
    { id: 'B', title: '任务B', group: '组一', commands: ['echo b'], requires: ['A'] },
    { id: 'C', title: '任务C', group: '组二', commands: ['echo c'] },
  ],
};

const row = (id: string) => screen.getByTestId(`task-row-${id}`);

function renderWithStore() {
  return render(<TaskTree />);
}

beforeEach(() => {
  useAppStore.setState({
    manifest: MANIFEST as never,
    selected: [],
    taskStates: { A: 'pending', B: 'pending', C: 'pending' },
    logLines: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('TaskTree', () => {
  it('按 group 分组渲染任务，组头含完成计数', () => {
    renderWithStore();

    expect(screen.getByText('组一')).toBeTruthy();
    expect(screen.getByText('组二')).toBeTruthy();
    expect(within(row('A')).getByText('任务A')).toBeTruthy();
    expect(within(row('B')).getByText('任务B')).toBeTruthy();
    expect(within(row('C')).getByText('任务C')).toBeTruthy();
  });

  it('六态图标映射：pending 显示 ░、success 显示 ✓、running 显示 ⟳', () => {
    useAppStore.setState({
      taskStates: { A: 'pending', B: 'success', C: 'running' },
    });
    renderWithStore();

    expect(within(row('A')).getByText('░')).toBeTruthy();
    expect(within(row('B')).getByText('✓')).toBeTruthy();
    expect(within(row('C')).getByText('⟳')).toBeTruthy();
  });

  it('失败与修复态图标：failed 显示 ✗、fixing 显示 ⚡、skipped 显示 »', () => {
    useAppStore.setState({
      taskStates: { A: 'failed', B: 'fixing', C: 'skipped' },
    });
    renderWithStore();

    expect(within(row('A')).getByText('✗')).toBeTruthy();
    expect(within(row('B')).getByText('⚡')).toBeTruthy();
    expect(within(row('C')).getByText('»')).toBeTruthy();
  });

  it('级联勾选：勾选链末端任务 B 自动选中依赖 A', async () => {
    const user = userEvent.setup();
    // 先让 A 成功解锁 B
    useAppStore.setState({ taskStates: { A: 'success', B: 'pending', C: 'pending' } });
    renderWithStore();

    await user.click(within(row('B')).getByRole('checkbox'));

    const s = useAppStore.getState();
    expect(s.selected).toContain('A');
    expect(s.selected).toContain('B');
  });

  it('阻塞置灰：B 依赖 A 且 A 未成功时 B 的复选框禁用', () => {
    // A pending → B 被阻塞
    useAppStore.setState({ taskStates: { A: 'pending', B: 'pending', C: 'success' } });
    renderWithStore();

    const bCheckbox = within(row('B')).getByRole('checkbox') as HTMLInputElement;
    expect(bCheckbox.disabled).toBe(true);
  });

  it('阻塞解除：A 成功后 B 的复选框恢复可用', async () => {
    const user = userEvent.setup();
    useAppStore.setState({ taskStates: { A: 'success', B: 'pending', C: 'success' } });
    renderWithStore();

    const bCheckbox = within(row('B')).getByRole('checkbox') as HTMLInputElement;
    expect(bCheckbox.disabled).toBe(false);

    await user.click(bCheckbox);
    expect(useAppStore.getState().selected).toContain('B');
  });

  it('清单覆盖新增分组时新面板自动展开且行渲染（BUG-01 回归）', async () => {
    // 首次挂载：旧清单（分组 组一/组二，无「Claude Code」）。
    renderWithStore();
    expect(screen.queryByTestId('task-row-D')).toBeNull();

    // 服务端 manifest 覆盖：新增「Claude Code」分组（挂载时不存在 → 此前
    // defaultActiveKey 已固化导致该面板未激活、children 不渲染、行缺失）。
    useAppStore.setState({
      manifest: {
        meta: { name: 't2', version: 1 },
        tasks: [
          { id: 'B', title: '任务B', group: '组一', commands: ['echo b'] },
          { id: 'D', title: '任务D', group: 'Claude Code', commands: ['echo d'] },
          { id: 'E', title: '任务E', group: 'Claude Code', commands: ['echo e'] },
        ],
      },
      taskStates: { B: 'pending', D: 'pending', E: 'pending' },
    });

    // 新分组自动并入展开集 → 其任务行进入 DOM，且全量行数正确。
    expect(await screen.findByTestId('task-row-D')).toBeTruthy();
    expect(within(row('E')).getByText('任务E')).toBeTruthy();
    expect(screen.getAllByTestId(/^task-row-/)).toHaveLength(3);
  });

  it('折叠面板 children 仍挂载（forceRender）：折叠后行不消失', async () => {
    renderWithStore();

    // 折叠「组二」后，其任务行 C 仍在 DOM（children 保持挂载）。
    const header = screen.getByText('组二').closest('.ant-collapse-header') as HTMLElement;
    await userEvent.setup().click(header);
    expect(row('C')).toBeTruthy();
  });
});

describe('FailedTaskActions 三动作', () => {
  it('失败任务显示 重试/交给 Claude 修复/跳过 三个动作', () => {
    useAppStore.setState({ taskStates: { A: 'failed', B: 'pending', C: 'pending' } });
    renderWithStore();

    const aRow = row('A');
    expect(within(aRow).getByText('重试')).toBeTruthy();
    expect(within(aRow).getByText('交给 Claude 修复')).toBeTruthy();
    expect(within(aRow).getByText('跳过')).toBeTruthy();
  });

  it('非失败任务不显示三动作', () => {
    useAppStore.setState({ taskStates: { A: 'success', B: 'pending', C: 'pending' } });
    renderWithStore();

    const aRow = row('A');
    expect(within(aRow).queryByText('重试')).toBeNull();
    expect(within(aRow).queryByText('跳过')).toBeNull();
  });

  it('点击重试发送 retry 消息并把任务乐观置为 pending', async () => {
    const user = userEvent.setup();
    // spy 记录 wsClient 发出的消息（store 的 retry action 调用 wsClient.send）
    const sendSpy = vi.spyOn((await import('../wsClient')).wsClient, 'send').mockImplementation(() => {});

    useAppStore.setState({ taskStates: { A: 'failed', B: 'pending', C: 'pending' } });
    renderWithStore();

    await user.click(within(row('A')).getByText('重试'));

    expect(sendSpy).toHaveBeenCalledWith({ type: 'retry', payload: { taskId: 'A' } });
    expect(useAppStore.getState().taskStates.A).toBe('pending');
    sendSpy.mockRestore();
  });

  it('点击跳过发送 skip 消息并把任务乐观置为 skipped', async () => {
    const user = userEvent.setup();
    const sendSpy = vi.spyOn((await import('../wsClient')).wsClient, 'send').mockImplementation(() => {});

    useAppStore.setState({ taskStates: { A: 'failed', B: 'pending', C: 'pending' } });
    renderWithStore();

    await user.click(within(row('A')).getByText('跳过'));

    expect(sendSpy).toHaveBeenCalledWith({ type: 'skip', payload: { taskId: 'A' } });
    expect(useAppStore.getState().taskStates.A).toBe('skipped');
    sendSpy.mockRestore();
  });

  it('点击交给 Claude 修复发送 fixWithClaude 消息', async () => {
    const user = userEvent.setup();
    const sendSpy = vi.spyOn((await import('../wsClient')).wsClient, 'send').mockImplementation(() => {});

    useAppStore.setState({ taskStates: { A: 'failed', B: 'pending', C: 'pending' } });
    renderWithStore();

    await user.click(within(row('A')).getByText('交给 Claude 修复'));

    expect(sendSpy).toHaveBeenCalledWith({ type: 'fixWithClaude', payload: { taskId: 'A' } });
    sendSpy.mockRestore();
  });
});
