/**
 * web/src/components/LogViewer.tsx
 *
 * xterm.js 执行日志终端（terminal-log-view SPEC）——替代 react-window 纯文本行。
 *
 *   - 独立 xterm 实例渲染（与 ClaudeTerminal 各自持有一个实例，互不窜流）。
 *   - 增量消费 store 的 `logLines` 环形缓冲：输出行原样 `term.write`
 *     （保留 ANSI 转义/进度条），命令分隔头写为纯文本分隔行。
 *   - 环形缓冲丢行（超出 5000 行上限）时整屏清空重写最近 N 行，避免 xterm
 *     历史无限膨胀（xterm 无内置截断）。
 *   - 自动滚底：xterm 在用户上翻后保持视口 → 上翻暂停跟随，出现「回到底部」
 *     按钮，点击恢复（沿用既有 LogViewer 交互）。
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, Space, Typography } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useAppStore, type LogLine } from '../stores/appStore';

const { Text } = Typography;

/** 跟随判定阈值（行）：视口距滚动底部 ≤ 该值视为「正在跟随」。 */
const FOLLOW_THRESHOLD_ROWS = 3;

/** 把一条 store 日志行渲染为终端文本：
 *  输出行原样透传（保留 ANSI）；命令分隔头写为分隔行（命令文本 + 已知退出码）。 */
function renderLine(line: LogLine): string {
  if (line.kind === 'header') {
    const exitMark = line.exitCode !== null ? `｜退出码 ${line.exitCode}` : '';
    return `──── ${line.taskId} ── ${line.command}${exitMark} ────\n`;
  }
  return `${line.data}\n`;
}

export default function LogViewer() {
  const logLines = useAppStore((s) => s.logLines);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  /** 已写入 xterm 的日志尾部 order（renderLine 消费的游标）。 */
  const tailOrderRef = useRef<number | null>(null);
  /** 已写入 xterm 的日志头部 order（环形缓冲丢行检测）。 */
  const headOrderRef = useRef<number | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowingState] = useState(true);

  const setFollowing = (value: boolean): void => {
    followingRef.current = value;
    setFollowingState(value);
  };

  /** 整屏清空重写最近 N 行（环形缓冲丢行后重建 xterm 内容）。 */
  function rebase(term: Terminal, lines: LogLine[]): void {
    term.clear();
    if (lines.length > 0) {
      term.write(lines.map(renderLine).join(''));
      headOrderRef.current = lines[0].order;
      tailOrderRef.current = lines[lines.length - 1].order;
    } else {
      headOrderRef.current = null;
      tailOrderRef.current = null;
    }
    term.scrollToBottom();
  }

  // -- 创建 xterm 实例（一次；与 ClaudeTerminal 完全独立） --------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;

    // 上翻暂停自动滚底：xterm 在用户上翻后保持视口；此处仅跟踪「是否在底部」。
    term.onScroll(() => {
      const t = termRef.current;
      if (!t) return;
      const maxScroll = t.buffer.active.length - t.rows;
      setFollowing(t.buffer.active.baseY >= maxScroll - FOLLOW_THRESHOLD_ROWS);
    });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => fit.fit());
      observer.observe(container);
    }

    // 挂载/重连：把 store 已有日志一次性写入（快照补发场景）。
    const initial = useAppStore.getState().logLines;
    if (initial.length > 0) {
      term.write(initial.map(renderLine).join(''));
      headOrderRef.current = initial[0].order;
      tailOrderRef.current = initial[initial.length - 1].order;
      term.scrollToBottom();
    }

    return () => {
      observer?.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // -- 增量写入 store 日志 ----------------------------------------------------
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (logLines.length === 0) {
      if (tailOrderRef.current !== null) rebase(term, []);
      return;
    }

    const headOrder = logLines[0].order;
    const tailOrder = logLines[logLines.length - 1].order;

    if (headOrderRef.current !== null && headOrder !== headOrderRef.current) {
      // 环形缓冲丢行（头部被丢弃）→ 整屏清空重写最近 N 行。
      rebase(term, logLines);
      return;
    }
    if (tailOrder === tailOrderRef.current) return; // 无新行

    // 增量：追加上次游标之后的新行（尾部连续，直接切片）。
    const newCount = tailOrder - (tailOrderRef.current ?? 0);
    const startIdx = logLines.length - newCount;
    const additions = logLines.slice(Math.max(0, startIdx));
    headOrderRef.current = logLines[0].order;
    tailOrderRef.current = logLines[logLines.length - 1].order;
    if (additions.length > 0) {
      term.write(additions.map(renderLine).join(''));
      if (followingRef.current) term.scrollToBottom();
    }
  }, [logLines]);

  return (
    <div style={{ position: 'relative', height: '100%' }} data-testid="exec-log-terminal">
      <div
        ref={containerRef}
        style={{ height: '100%', background: '#1e1e1e', padding: 8, overflow: 'hidden' }}
        data-testid="exec-log-xterm"
      />

      {!following && logLines.length > 0 && (
        <Button
          size="small"
          type="primary"
          icon={<DownOutlined />}
          style={{ position: 'absolute', bottom: 8, right: 16 }}
          onClick={() => {
            termRef.current?.scrollToBottom();
            setFollowing(true);
          }}
        >
          回到底部
        </Button>
      )}

      <Space size={4} style={{ position: 'absolute', top: 0, right: 8 }} wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {logLines.length} 行
        </Text>
      </Space>
    </div>
  );
}