/**
 * web/src/components/ExecutionSteps.test.tsx
 *
 * 步骤导航条测试（execution-navigation SPEC）：
 *   - topoOrder 依赖先行 + 同层声明序稳定；环 → 空数组
 *   - 组件渲染：Step 顺序 = 拓扑序；状态映射 success→finish /
 *     running→process / 其余→wait；tooltip 标注 group
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import ExecutionSteps, { topoOrder } from './ExecutionSteps';
import type { Task } from '@fenix/shared/schema';

const TASKS: Task[] = [
  { id: 'install-base', title: '安装基础依赖', group: '系统基础', commands: ['echo a'], needs_proxy: false, requires: [], files: [] },
  { id: 'clone-repo', title: '克隆仓库', group: '构建', commands: ['echo b'], needs_proxy: false, requires: ['install-base'], files: [] },
  { id: 'build', title: '构建产物', group: '构建', commands: ['echo c'], needs_proxy: false, requires: ['clone-repo'], files: [] },
];

function renderSteps() {
  return render(<ExecutionSteps />);
}

/** 按 DOM 顺序收集全部 Step 的 data-testid（验证拓扑序渲染顺序）。 */
function domStepOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.ant-steps-item')].map((el) =>
    el.querySelector('[data-testid^="step-title-"]')?.getAttribute('data-testid') ?? '',
  );
}

function stepEl(id: string): HTMLElement {
  return screen.getByTestId(`step-title-${id}`).closest('.ant-steps-item') as HTMLElement;
}

beforeEach(() => {
  useAppStore.setState({
    manifest: { meta: { name: 't', version: 1 }, tasks: TASKS },
    taskStates: { 'install-base': 'pending', 'clone-repo': 'pending', build: 'pending' },
  });
});

afterEach(() => { cleanup(); });

describe('topoOrder', () => {
  it('依赖先行且同层保持声明序', () => {
    expect(topoOrder(TASKS)).toEqual(['install-base', 'clone-repo', 'build']);
  });

  it('声明序反转时仍保证依赖先于依赖者', () => {
    const reversed = [...TASKS].reverse();
    const order = topoOrder(reversed);
    expect(order.indexOf('install-base')).toBeLessThan(order.indexOf('clone-repo'));
    expect(order.indexOf('clone-repo')).toBeLessThan(order.indexOf('build'));
  });

  it('存在环 → 返回空数组（调用方降级为不渲染）', () => {
    const cyclic: Task[] = [
      { ...TASKS[0], requires: ['build'] },
      TASKS[1],
      TASKS[2],
    ];
    expect(topoOrder(cyclic)).toEqual([]);
  });
});

describe('ExecutionSteps', () => {
  it('连接后（全部 pending）→ 按拓扑序渲染全部步骤，均为 wait 状态', () => {
    const { container } = renderSteps();

    expect(domStepOrder(container)).toEqual([
      'step-title-install-base',
      'step-title-clone-repo',
      'step-title-build',
    ]);
    expect(stepEl('install-base').className).toContain('ant-steps-item-wait');
    expect(stepEl('clone-repo').className).toContain('ant-steps-item-wait');
    expect(stepEl('build').className).toContain('ant-steps-item-wait');
  });

  it('状态映射：success→finish、running→process、pending→wait', () => {
    useAppStore.setState({
      taskStates: { 'install-base': 'success', 'clone-repo': 'running', build: 'pending' },
    });
    renderSteps();

    expect(stepEl('install-base').className).toContain('ant-steps-item-finish');
    expect(stepEl('clone-repo').className).toContain('ant-steps-item-process');
    expect(stepEl('build').className).toContain('ant-steps-item-wait');
  });

  it('依赖顺序与执行进度联动：下游未跑时上游 finish 不变', () => {
    useAppStore.setState({
      taskStates: { 'install-base': 'success', 'clone-repo': 'success', build: 'pending' },
    });
    renderSteps();

    expect(stepEl('install-base').className).toContain('ant-steps-item-finish');
    expect(stepEl('clone-repo').className).toContain('ant-steps-item-finish');
    expect(stepEl('build').className).toContain('ant-steps-item-wait');
  });

  it('无清单时渲染为空（不抛错）', () => {
    useAppStore.setState({ manifest: null, taskStates: {} });
    const { container } = renderSteps();
    expect(container.querySelector('[data-testid="execution-steps"]')).toBeNull();
  });
});