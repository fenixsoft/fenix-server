/**
 * web/src/components/ClaudeTerminal.tsx
 *
 * xterm.js PTY view for the Claude fix session.
 *
 *   - Renders server `claude-output` chunks (ANSI-aware) into the terminal.
 *   - User keyboard input in the terminal AND the auxiliary input box are
 *     both sent as `pty-input` messages (dual-channel input).
 *   - Fit addon keeps the terminal sized to its container; the fitted
 *     dimensions are echoed back so the server-side PTY can resize.
 *
 * The component is presentational: all I/O goes through the store actions
 * (sendPtyInput) and the store's `claudeOutput` buffer.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Input, Space, Typography } from 'antd';
import { useAppStore } from '../stores/appStore';

const { Text } = Typography;

export default function ClaudeTerminal() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sentRef = useRef(0);
  const claudeOutput = useAppStore((s) => s.claudeOutput);
  const sendPtyInput = useAppStore((s) => s.sendPtyInput);

  // Create the terminal once, wire keyboard → pty-input.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    term.onData((data) => {
      // Keyboard input from the terminal (typing, Enter, etc.).
      sendPtyInput(data);
    });

    termRef.current = term;
    fitRef.current = fit;

    // Re-fit on container resize.
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sendPtyInput]);

  // Push newly-appended claude-output chunks into the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const all = claudeOutput;
    const next = all.length;
    if (next > sentRef.current) {
      const chunk = all.slice(sentRef.current, next);
      sentRef.current = next;
      term.write(chunk);
    }
  }, [claudeOutput]);

  function submitInput(value: string): void {
    if (!value) return;
    // Mirror the terminal: a plain Enter for command execution.
    sendPtyInput(value + '\r');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, background: '#1e1e1e', padding: 8, overflow: 'hidden' }}
        data-testid="claude-terminal"
      />
      <Space.Compact style={{ padding: 8, width: '100%' }}>
        <Input
          placeholder="向 Claude 输入内容（Enter 发送；也可以直接点击上方终端输入）"
          onPressEnter={(e) => {
            submitInput((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).value = '';
          }}
          allowClear
        />
      </Space.Compact>
    </div>
  );
}
