/**
 * web/src/components/ExecutionToolbar.tsx
 *
 * Execution control bar:
 *   - 全选 / 清空 selection (both respect the local cascade & blocked rules)
 *   - 执行选中 (queued n/N progress bar)
 *   - 停止 (abort current run)
 *
 * Buttons are gated on connection + selection state; the run progress comes
 * from the store's `progress` slice (driven by server `progress` messages).
 */
import { Badge, Button, Progress, Space } from 'antd';
import {
  CheckSquareOutlined,
  ClearOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';

export default function ExecutionToolbar() {
  const selected = useAppStore((s) => s.selected);
  const progress = useAppStore((s) => s.progress);
  const running = useAppStore((s) => Object.values(s.taskStates).includes('running'));
  const connectStatus = useAppStore((s) => s.sshStatus);
  const selectAll = useAppStore((s) => s.selectAll);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const exec = useAppStore((s) => s.exec);
  const stop = useAppStore((s) => s.stop);

  const connected = connectStatus === 'ready';
  const hasSelection = selected.length > 0;
  const percent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Space wrap>
        <Button size="small" icon={<CheckSquareOutlined />} onClick={selectAll} disabled={!connected}>
          全选
        </Button>
        <Button size="small" icon={<ClearOutlined />} onClick={clearSelection} disabled={!connected}>
          清空
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<PlayCircleOutlined />}
          onClick={() => exec()}
          disabled={!connected || !hasSelection || running}
        >
          执行选中（{selected.length}）
        </Button>
        <Button danger size="small" icon={<StopOutlined />} onClick={stop} disabled={!running}>
          停止
        </Button>
      </Space>

      {progress.total > 0 && (
        <Space size={8} style={{ width: '100%' }}>
          <Progress
            percent={percent}
            size="small"
            style={{ flex: 1, margin: 0 }}
            format={() => `${progress.completed}/${progress.total}`}
          />
          {running && <Badge status="processing" text="执行中" />}
        </Space>
      )}
    </Space>
  );
}