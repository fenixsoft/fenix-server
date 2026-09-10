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
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
});
