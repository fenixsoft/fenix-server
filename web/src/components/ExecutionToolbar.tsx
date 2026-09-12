/**
 * web/src/components/ExecutionToolbar.tsx
 *
 * Execution control bar:
 *   - 全选 / 清空 selection (both respect the local cascade & blocked rules)
 *   - 执行选中 (queued n/N progress bar)
 *   - 执行全部：按依赖拓扑执行全部可执行任务（跳过已 success，重跑开关开启时纳入）
 *   - 全部重跑 Switch：开启时已 success 任务也被纳入执行队列（rerun 标记）
 *   - 停止 (abort current run)
 *
 * Buttons are gated on connection + selection state; the run progress comes
 * from the store's `progress` slice (driven by server `progress` messages).
 */
import { Badge, Button, Progress, Space, Switch, Typography } from 'antd';
import {
  CheckSquareOutlined,
  ClearOutlined,
  PlayCircleOutlined,
  PlaySquareOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';

const { Text } = Typography;

export default function ExecutionToolbar() {
  const selected = useAppStore((s) => s.selected);
  const progress = useAppStore((s) => s.progress);
  const running = useAppStore((s) => Object.values(s.taskStates).includes('running'));
  const rerunAll = useAppStore((s) => s.rerunAll);
  const connectStatus = useAppStore((s) => s.sshStatus);
  const selectAll = useAppStore((s) => s.selectAll);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const exec = useAppStore((s) => s.exec);
  const execAll = useAppStore((s) => s.execAll);
  const setRerunAll = useAppStore((s) => s.setRerunAll);
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
        {/* 执行全部：完整依赖闭包，跳过已 success 任务（与 dependency-rerun-fix
            语义一致）；执行中禁用防重复触发。 */}
        <Button
          size="small"
          icon={<PlaySquareOutlined />}
          onClick={() => execAll()}
          disabled={!connected || running}
        >
          执行全部
        </Button>
        <Button danger size="small" icon={<StopOutlined />} onClick={stop} disabled={!running}>
          停止
        </Button>
      </Space>

      <Space size={8} wrap>
        <Switch
          size="small"
          checked={rerunAll}
          onChange={setRerunAll}
          disabled={!connected}
        />
        <Text style={{ fontSize: 12 }} type="secondary">
          全部重跑{rerunAll ? '（含已完成任务）' : ''}
        </Text>
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