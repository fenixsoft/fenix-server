/**
 * web/src/components/LogViewer.tsx
 *
 * Virtualised execution log viewer (react-window, fixed row height).
 *
 * Behaviour:
 *   - Rows come from the store's ring-buffered `logLines`.
 *   - Auto-follow: when a new row arrives and the list is near the bottom
 *     (within `FOLLOW_THRESHOLD` px), it scrolls to the bottom. If the user
 *     scrolled up beyond the threshold, following pauses and a "回到底部"
 *     affordance appears; clicking it resumes following.
 *   - Command headers (kind: 'header') render as separators with the command
 *     text and an exit-code badge (green for 0, red otherwise / unknown).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { Badge, Button, Space, Typography, theme } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useAppStore, type LogLine } from '../stores/appStore';

const { Text } = Typography;

const ROW_HEIGHT = 22;
const FOLLOW_THRESHOLD = 40;

// ---------------------------------------------------------------------------
//  Row renderer
// ---------------------------------------------------------------------------

function LogRow({ index, style, data }: ListChildComponentProps<LogLine[]>) {
  const line = data[index];
  const { token } = theme.useToken();

  if (line.kind === 'header') {
    const ok = line.exitCode === 0;
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          background: ok
            ? token.colorSuccessBg
            : line.exitCode === null
              ? token.colorFillTertiary
              : token.colorErrorBg,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
        data-testid={`log-header-${line.taskId}-${line.order}`}
      >
        <Text strong style={{ fontSize: 12, flexShrink: 0 }}>
          ── {line.taskId} ──
        </Text>
        <Text code style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {line.command}
        </Text>
        <Badge
          status={line.exitCode === null ? 'processing' : ok ? 'success' : 'error'}
          text={line.exitCode === null ? '运行中' : ok ? `退出码 0` : `退出码 ${line.exitCode}`}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...style,
        padding: '0 8px',
        fontFamily: 'monospace',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: line.stream === 'stderr' ? token.colorError : token.colorText,
      }}
      data-testid={`log-line-${line.taskId}-${line.order}`}
    >
      {line.data}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function LogViewer() {
  const logLines = useAppStore((s) => s.logLines);
  const listRef = useRef<FixedSizeList<LogLine[]> | null>(null);
  const [followBottom, setFollowBottom] = useState(true);
  const currentCount = useRef(logLines.length);

  // When rows are appended and we're following, jump to the bottom.
  useEffect(() => {
    if (followBottom && logLines.length !== currentCount.current) {
      currentCount.current = logLines.length;
      listRef.current?.scrollToItem(logLines.length - 1);
    }
  }, [logLines.length, followBottom]);

  const itemData = useMemo(() => logLines, [logLines]);

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <FixedSizeList<LogLine[]>
        ref={listRef}
        height={400}
        itemCount={logLines.length}
        itemSize={ROW_HEIGHT}
        width="100%"
        itemData={itemData}
        onScroll={({ scrollOffset }) => {
          const maxScroll = logLines.length * ROW_HEIGHT - 400;
          setFollowBottom(maxScroll - scrollOffset < FOLLOW_THRESHOLD);
        }}
      >
        {LogRow}
      </FixedSizeList>

      {!followBottom && logLines.length > 0 && (
        <Button
          size="small"
          type="primary"
          icon={<DownOutlined />}
          style={{ position: 'absolute', bottom: 8, right: 16 }}
          onClick={() => {
            setFollowBottom(true);
            listRef.current?.scrollToItem(logLines.length - 1);
          }}
        >
          回到底部
        </Button>
      )}

      <Space
        size={4}
        style={{ position: 'absolute', top: 0, right: 8 }}
        wrap
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {logLines.length} 行
        </Text>
      </Space>
    </div>
  );
}
