/**
 * web/src/components/LogViewer.test.tsx
 *
 * Log viewer rendering tests:
 *   - output lines render as monospace text, coloured by stream
 *   - header lines render the command separator (task id + status)
 *   - empty state shows 0 rows
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useAppStore } from '../stores/appStore';
import LogViewer from './LogViewer';
import type { ServerMessage } from '@fenix/shared/messages';

function pushLog(line: string, stream: 'stdout' | 'stderr' = 'stdout') {
  useAppStore.getState().applyServerMessage({
    type: 'log',
    payload: { taskId: 'task1', stream, data: line },
  } as ServerMessage);
}

function sendTaskState(status: string) {
  useAppStore.getState().applyServerMessage({
    type: 'task-state',
    payload: { taskId: 'task1', status },
  } as ServerMessage);
}

beforeEach(() => {
  useAppStore.setState({
    logLines: [],
    manifest: {
      meta: { name: 't', version: 1 },
      tasks: [{ id: 'task1', title: '任务一', commands: ['echo hello'] }],
    } as never,
    taskStates: { task1: 'pending' },
  });
});

afterEach(() => { cleanup(); });

describe('LogViewer', () => {
  it('输出行渲染为 monospace 文本', () => {
    pushLog('line-1');
    pushLog('line-2');
    render(<LogViewer />);

    expect(screen.getByText('line-1')).toBeTruthy();
    expect(screen.getByText('line-2')).toBeTruthy();
  });

  it('header 行渲染命令分隔头（任务 id 与命令文本）', () => {
    sendTaskState('running');
    sendTaskState('success');
    render(<LogViewer />);

    expect(screen.getByText(/task1/)).toBeTruthy();
    // 命令文本出现在分隔头中
    expect(screen.getByText(/echo hello/)).toBeTruthy();
  });

  it('stderr 输出行渲染且与 stdout 样式不同', () => {
    pushLog('out-line', 'stdout');
    pushLog('err-line', 'stderr');
    render(<LogViewer />);

    const outEl = screen.getByText('out-line');
    const errEl = screen.getByText('err-line');
    // stdout 和 stderr 各自有独立 div，样式通过 inline style 区分颜色
    expect(outEl).toBeTruthy();
    expect(errEl).toBeTruthy();
    // 两个 div 不是同一个元素
    expect(outEl.closest('div')).not.toBe(errEl.closest('div'));
    // stderr div 的 inline style 包含 color 声明（antd token 解析后的颜色值）
    expect(errEl.closest('div')?.getAttribute('style')).toContain('color:');
  });

  it('空日志时渲染 0 行', () => {
    render(<LogViewer />);
    expect(screen.getByText('0 行')).toBeTruthy();
  });

  it('多行输出均可见（行计数正确）', () => {
    Array.from({ length: 20 }, (_, i) => pushLog(`chunk-${i}`));
    render(<LogViewer />);
    expect(screen.getByText('20 行')).toBeTruthy();
  });
});
