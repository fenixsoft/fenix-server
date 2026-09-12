/**
 * web/src/components/LogViewer.test.tsx
 *
 * xterm 执行日志终端测试（terminal-log-view SPEC）。
 *
 * jsdom 下 @xterm/xterm 的字符测量（canvas getContext）不可用，无法读取
 * 渲染文本 —— 故 mock @xterm/xterm 捕获 write/clear/scroll 调用序列：
 *   - 输出行（含 ANSI）原样写入终端
 *   - 命令分隔头写为分隔行
 *   - 环形缓冲丢行 → 整屏清空重写（clear + 重写最近 N 行）
 *   - 上翻暂停自动滚底 + 回到底部按钮恢复
 *   - 两终端隔离：执行日志 xterm 与 Claude 修复终端各自独立、互不窜流
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore, LOG_RING_LIMIT } from '../stores/appStore';
import LogViewer from './LogViewer';
import ClaudeTerminal from './ClaudeTerminal';
import type { ServerMessage } from '@fenix/shared/messages';

// ---------------------------------------------------------------------------
//  xterm 模块 mock（捕获写入与实例数）
// ---------------------------------------------------------------------------

const terminalMock = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    writes: string[] = [];
    clearCalls = 0;
    scrollToBottomCalls = 0;
    disposeCalls = 0;
    rows = 24;
    buffer = { active: { length: 0, baseY: 0 } };
    private scrollHandler: (() => void) | null = null;

    constructor() {
      FakeTerminal.instances.push(this);
    }
    loadAddon(): void {}
    open(): void {}
    onScroll(cb: () => void): void { this.scrollHandler = cb; }
    onData(): void {}
    write(data: string): void { this.writes.push(data); }
    scrollToBottom(): void { this.scrollToBottomCalls += 1; }
    clear(): void { this.clearCalls += 1; }
    dispose(): void { this.disposeCalls += 1; }
    /** 模拟用户滚动到指定位置（baseY / length），驱动 onScroll。 */
    emitScroll(baseY: number, length: number): void {
      this.buffer.active.baseY = baseY;
      this.buffer.active.length = length;
      this.scrollHandler?.();
    }
  }
  return { FakeTerminal };
});

vi.mock('@xterm/xterm', () => ({ Terminal: terminalMock.FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }));

// ---------------------------------------------------------------------------
//  辅助
// ---------------------------------------------------------------------------

const MANIFEST = {
  meta: { name: 't', version: 1 },
  tasks: [{ id: 'task1', title: '任务一', commands: ['echo hello'], needs_proxy: false, requires: [], files: [] }],
};

function send(msg: ServerMessage) {
  useAppStore.getState().applyServerMessage(msg);
}

function sendLog(data: string, stream: 'stdout' | 'stderr' = 'stdout') {
  send({ type: 'log', payload: { taskId: 'task1', stream, data } });
}

function sendTaskState(status: string) {
  send({ type: 'task-state', payload: { taskId: 'task1', status: status as import('@fenix/shared/messages').TaskStatus } });
}

beforeEach(() => {
  terminalMock.FakeTerminal.instances = [];
  useAppStore.setState({
    manifest: MANIFEST as never,
    taskStates: { task1: 'pending' },
    logLines: [],
    claudeOutput: '',
    selected: [],
    progress: { completed: 0, total: 0 },
  });
});

afterEach(() => { cleanup(); });

describe('LogViewer（xterm）', () => {
  it('输出行写入 xterm，ANSI 转义原样保留', async () => {
    render(<LogViewer />);
    const term = terminalMock.FakeTerminal.instances[0];

    act(() => { sendLog('line-1\n'); });
    act(() => { sendLog('\x1b[31mred-ansi\x1b[0m'); });
    await act(async () => {});

    const text = term.writes.join('');
    expect(text).toContain('line-1');
    expect(text).toContain('\x1b[31mred-ansi\x1b[0m'); // 不剥离转义
  });

  it('命令分隔头写为分隔行（任务 id + 命令文本）', async () => {
    render(<LogViewer />);
    const term = terminalMock.FakeTerminal.instances[0];

    act(() => { sendTaskState('running'); });
    act(() => { sendTaskState('success'); });
    await act(async () => {});

    const text = term.writes.join('');
    expect(text).toContain('──── task1 ── echo hello ────');
  });

  it('环形缓冲丢行 → 整屏清空重写最近 N 行（xterm 历史不膨胀）', async () => {
    render(<LogViewer />);
    const term = terminalMock.FakeTerminal.instances[0];

    // 先写入一批，让游标建立；再灌满直至环形缓冲丢行。
    for (let i = 0; i < 50; i++) {
      act(() => { sendLog(`chunk-${i}`); });
    }
    expect(term.writes.join('')).toContain('chunk-49');
    const clearBefore = term.clearCalls;

    for (let i = 50; i < LOG_RING_LIMIT + 50; i++) {
      act(() => { sendLog(`chunk-${i}`); });
    }
    await act(async () => {});

    // 环形缓冲丢弃最旧行 → 触发清屏重建（clear 被调用，且重写包含最新行）。
    expect(term.clearCalls).toBeGreaterThan(clearBefore);
    const rebuilt = term.writes.slice(-10).join('');
    expect(rebuilt).toContain(`chunk-${LOG_RING_LIMIT + 49}`);
    // 行数统计仍为 5000（store 环形缓冲上限）。
    expect(screen.getByText(`${LOG_RING_LIMIT} 行`)).toBeTruthy();
  });

  it('上翻暂停自动滚底；「回到底部」恢复跟随', async () => {
    const user = userEvent.setup();
    render(<LogViewer />);
    const term = terminalMock.FakeTerminal.instances[0];
    act(() => { sendLog('a'); sendLog('b'); sendLog('c'); });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /回到底部/ })).toBeNull();

    // 模拟用户上翻：baseY 远小于最大滚动量 → 暂停跟随，按钮出现。
    act(() => { term.emitScroll(2, 200); });
    expect(screen.getByRole('button', { name: /回到底部/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /回到底部/ }));
    expect(term.scrollToBottomCalls).toBeGreaterThan(0);
    // 恢复跟随后按钮消失。
    expect(screen.queryByRole('button', { name: /回到底部/ })).toBeNull();
  });

  it('空日志显示 0 行', () => {
    render(<LogViewer />);
    expect(screen.getByText('0 行')).toBeTruthy();
  });

  it('重连补发：挂载时 store 已有日志一次性写入（快照恢复）', async () => {
    // 先注入历史日志再挂载。
    useAppStore.setState({
      manifest: MANIFEST as never,
      logLines: [
        { kind: 'output', taskId: 'task1', order: 1, stream: 'stdout', data: 'snapshot-line', timestamp: 0 },
        { kind: 'header', taskId: 'task1', order: 2, command: 'echo hello', exitCode: 0, status: 'success', timestamp: 0 },
      ],
    });
    render(<LogViewer />);
    const term = terminalMock.FakeTerminal.instances[0];
    const text = term.writes.join('');
    expect(text).toContain('snapshot-line');
    expect(text).toContain('──── task1 ── echo hello');
  });
});

describe('两终端隔离（execution log × Claude terminal）', () => {
  it('执行日志 xterm 与 Claude 修复终端各自独立，互不窜流', async () => {
    render(<LogViewer />);
    const logTerm = terminalMock.FakeTerminal.instances[0];

    render(<ClaudeTerminal />);
    const claudeTerm = terminalMock.FakeTerminal.instances[1];
    expect(terminalMock.FakeTerminal.instances).toHaveLength(2);

    // claude-output → 只进 Claude 终端
    act(() => { send({ type: 'claude-output', payload: { data: 'hi-claude' } }); });
    await act(async () => {});
    expect(claudeTerm.writes.join('')).toContain('hi-claude');
    expect(logTerm.writes.join('')).not.toContain('hi-claude');

    // log → 只进执行日志终端
    act(() => { sendLog('hi-exec-log'); });
    await act(async () => {});
    expect(logTerm.writes.join('')).toContain('hi-exec-log');
    expect(claudeTerm.writes.join('')).not.toContain('hi-exec-log');
  });
});