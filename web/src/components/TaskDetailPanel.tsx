/**
 * web/src/components/TaskDetailPanel.tsx
 *
 * Task detail panel: shows the selected task's description, ordered command
 * list, verify command, dependencies, file manifest and current status.
 * Content is read straight from the manifest (`Task`), matching the YAML
 * definition one-to-one (task-board requirement).
 */
import { Empty, Descriptions, Tag, Typography, Space } from 'antd';
import type { TaskStatus } from '@fenix/shared/messages';
import type { Task } from '@fenix/shared/schema';

const { Text } = Typography;

/** Status tag colour per state (matches the tree icon semantics). */
const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  fixing: 'warning',
  skipped: 'default',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  fixing: '修复中',
  skipped: '跳过',
};

interface TaskDetailPanelProps {
  task: Task | null;
  status: TaskStatus;
}

export default function TaskDetailPanel({ task, status }: TaskDetailPanelProps) {
  if (!task) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description="点击左侧任务查看详情" />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space align="center" wrap>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {task.title}
          </Typography.Title>
          <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>
          {task.needs_proxy && <Tag color="blue">需要代理</Tag>}
        </Space>

        {task.description && (
          <Text type="secondary">{task.description}</Text>
        )}

        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            {
              key: 'commands',
              label: '命令列表',
              children: (
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  {task.commands.map((cmd, i) => (
                    <Text key={i} code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      ${' '}{cmd}
                    </Text>
                  ))}
                </Space>
              ),
            },
            {
              key: 'verify',
              label: '验证命令',
              children: task.verify ? <Text code>{task.verify}</Text> : <Text type="secondary">无</Text>,
            },
            {
              key: 'requires',
              label: '依赖',
              children:
                task.requires.length > 0 ? (
                  <Space size={4} wrap>
                    {task.requires.map((dep) => <Tag key={dep}>{dep}</Tag>)}
                  </Space>
                ) : (
                  <Text type="secondary">无</Text>
                ),
            },
            {
              key: 'files',
              label: '文件清单',
              children:
                task.files.length > 0 ? (
                  <Space direction="vertical" size={2}>
                    {task.files.map((f) => <Text key={f} code>{f}</Text>)}
                  </Space>
                ) : (
                  <Text type="secondary">无</Text>
                ),
            },
            {
              key: 'claude_hint',
              label: 'Claude 修复提示',
              children: task.claude_hint ? <Text>{task.claude_hint}</Text> : <Text type="secondary">无</Text>,
            },
          ]}
        />
      </Space>
    </div>
  );
}
