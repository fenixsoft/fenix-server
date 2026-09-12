/**
 * web/src/views/TaskView.test.tsx
 *
 * 任务视图冒烟（execution-navigation SPEC 场景：连接后步骤导航条与清单一致）。
 * 用真实内置清单 assets/tasks.yaml（17 任务）挂载 TaskView，断言：
 *   - Steps 导航条渲染 17 个 Step（与清单任务数一致）
 *   - 全部为 wait 状态（连接初始快照）
 *   - 双栏布局（左树 + 右 Tab）与导航条并存渲染
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseTaskManifest, type TaskManifest } from '@fenix/shared/schema';
import { useAppStore } from '../stores/appStore';
import TaskView from './TaskView';

const terminalMock = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    writes: string[] = [];
    rows = 24;
    buffer = { active: { length: 0, baseY: 0 } };
    private scrollHandler: (() => void) | null = null;
    constructor() { FakeTerminal.instances.push(this); }
    loadAddon(): void {}
    open(): void {}
    onScroll(cb: () => void): void { this.scrollHandler = cb; }
    onData(): void {}
    write(data: string): void { this.writes.push(data); }
    scrollToBottom(): void {}
    clear(): void {}
    dispose(): void {}
  }
  return { FakeTerminal };
});

vi.mock('@xterm/xterm', () => ({ Terminal: terminalMock.FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }));

/** 解析真实内置清单（17 任务，与 server assets/tasks.yaml 一致）。 */
function builtinManifest(): TaskManifest {
  const yamlText = readFileSync(join(process.cwd(), 'assets/tasks.yaml'), 'utf8');
  const result = parseTaskManifest(parse(yamlText));
  if (!result.ok) throw new Error('assets/tasks.yaml 校验失败');
  return result.manifest;
}

beforeEach(() => {
  terminalMock.FakeTerminal.instances = [];
  const manifest = builtinManifest();
  useAppStore.setState({
    manifest,
    manifestSource: 'builtin',
    sshStatus: 'ready',
    taskStates: Object.fromEntries(manifest.tasks.map((t) => [t.id, 'pending' as const])),
    selected: [],
    progress: { completed: 0, total: 0 },
    rerunAll: false,
    lastError: null,
  });
});

describe('TaskView（连接后冒烟）', () => {
  it('Step 导航条展示与清单一致的步骤数（17 步），全部为 wait', () => {
    render(<TaskView />);

    const steps = screen.getAllByTestId(/^step-title-/);
    expect(steps).toHaveLength(17);
    // 全部 pending → 全部 wait 态。
    for (const el of steps) {
      expect(el.closest('.ant-steps-item')?.className).toContain('ant-steps-item-wait');
    }
    // 任务树与导航条并存（左树渲染任务行）。
    expect(screen.getByTestId('task-row-install-claude-code')).toBeTruthy();
    cleanup();
  });

  it('执行进度实时联动：success→finish、running→process', () => {
    const manifest = builtinManifest();
    const first = manifest.tasks[0];
    const second = manifest.tasks.find((t) => t.id !== first.id)!;
    useAppStore.setState({
      taskStates: {
        ...Object.fromEntries(manifest.tasks.map((t) => [t.id, 'pending' as const])),
        [first.id]: 'success',
        [second.id]: 'running',
      },
    });
    useAppStore.getState().applyServerMessage({
      type: 'progress',
      payload: { completed: 1, total: 2 },
    });

    render(<TaskView />);
    const firstEl = screen.getByTestId(`step-title-${first.id}`);
    const secondEl = screen.getByTestId(`step-title-${second.id}`);
    expect(firstEl.closest('.ant-steps-item')?.className).toContain('ant-steps-item-finish');
    expect(secondEl.closest('.ant-steps-item')?.className).toContain('ant-steps-item-process');
    cleanup();
  });
});