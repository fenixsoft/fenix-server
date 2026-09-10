/**
 * web/src/components/FailedTaskActions.tsx
 *
 * Three recovery actions shown on a failed task row:
 *   - 重试 (retry)              → { type: 'retry', payload: { taskId } }
 *   - 交给 Claude 修复 (fix)    → { type: 'fixWithClaude', payload: { taskId } }
 *   - 跳过 (skip)               → { type: 'skip', payload: { taskId } }
 *
 * Buttons live only while the task is in the 'failed' state and disable
 * themselves when the runner is mid-run (another task running) to avoid
 * racing decisions; the store's optimistic state update drives the row
 * transition back to running/pending/skipped as the server acknowledges.
 */
import { Button, Space, Tooltip } from 'antd';
import { RedoOutlined, RobotOutlined, FastForwardOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import type { TaskStatus } from '@fenix/shared/messages';

interface FailedTaskActionsProps {
  taskId: string;
  status: TaskStatus;
}

export default function FailedTaskActions({ taskId, status }: FailedTaskActionsProps) {
  const retry = useAppStore((s) => s.retry);
  const skip = useAppStore((s) => s.skip);
  const fixWithClaude = useAppStore((s) => s.fixWithClaude);
  const anyRunning = useAppStore((s) => Object.values(s.taskStates).includes('running'));

  if (status !== 'failed') return null;

  return (
    <Space size={2} wrap>
      <Tooltip title="重新执行该任务">
        <Button size="small" icon={<RedoOutlined />} disabled={anyRunning} onClick={() => retry(taskId)}>
          重试
        </Button>
      </Tooltip>
      <Tooltip title="交给 Claude 修复（后端 add-claude-fallback）">
        <Button size="small" icon={<RobotOutlined />} disabled={anyRunning} onClick={() => fixWithClaude(taskId)}>
          交给 Claude 修复
        </Button>
      </Tooltip>
      <Tooltip title="跳过该任务，继续队列后续任务">
        <Button size="small" icon={<FastForwardOutlined />} disabled={anyRunning} onClick={() => skip(taskId)}>
          跳过
        </Button>
      </Tooltip>
    </Space>
  );
}
