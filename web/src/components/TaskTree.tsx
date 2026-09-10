/**
 * web/src/components/TaskTree.tsx
 *
 * Grouped, collapsible task list with:
 *   - Status icons mapped to six terminal states (░ ⟳ ✓ ✗ ⚡ »)
 *   - Cascade selection via the store's `toggleTask` (requires-closure)
 *   - Greyed-out disabled checkboxes when a direct dependency is not yet
 *     in the "success" state (isBlocked rule)
 *
 * The component is purely presentational + store-aware: it reads tasks,
 * states, selected, and blocked from the Zustand store and calls
 * `toggleTask` when the user interacts.
 */
import { useMemo } from 'react';
import { Checkbox, Collapse, Typography, Tooltip, theme } from 'antd';
import { useAppStore } from '../stores/appStore';
import FailedTaskActions from './FailedTaskActions';
import type { Task } from '@fenix/shared/schema';
import type { TaskStatus } from '@fenix/shared/messages';

const { Text } = Typography;

// ---------------------------------------------------------------------------
//  Status icon map
// ---------------------------------------------------------------------------

/** Explicit six-state icons matching design doc §8 key interactions. */
const STATUS_ICON: Record<TaskStatus, { icon: string; color: string; label: string }> = {
  pending:  { icon: '░', color: '#bfbfbf', label: '待执行' },
  running:  { icon: '⟳', color: '#2f6fed', label: '执行中' },
  success:  { icon: '✓', color: '#52c41a', label: '成功' },
  failed:   { icon: '✗', color: '#ff4d4f', label: '失败' },
  fixing:   { icon: '⚡', color: '#fa8c16', label: '修复中' },
  skipped:  { icon: '»', color: '#8c8c8c', label: '跳过' },
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Group tasks by `group`, preserving declaration order. */
function groupTasks(tasks: Task[]): Map<string, Task[]> {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const group = task.group ?? '未分组';
    const list = groups.get(group);
    if (list) list.push(task);
    else groups.set(group, [task]);
  }
  return groups;
}

/** Check whether a task is blocked (any direct dependency not in success). */
function isBlocked(task: Task, states: Record<string, TaskStatus>): boolean {
  return (task.requires ?? []).some((dep) => states[dep] !== 'success');
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function TaskTree() {
  const manifest = useAppStore((s) => s.manifest);
  const states = useAppStore((s) => s.taskStates);
  const selected = useAppStore((s) => s.selected);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const { token } = theme.useToken();

  const grouped = useMemo(() => {
    if (!manifest) return [];
    return [...groupTasks(manifest.tasks).entries()];
  }, [manifest]);

  if (!manifest || manifest.tasks.length === 0) {
    return <Text type="secondary">暂无任务清单。请在连接视图中选择清单。</Text>;
  }

  return (
    <Collapse
      defaultActiveKey={grouped.map(([group]) => group)}
      size="small"
      ghost
      style={{ background: 'transparent' }}
      items={grouped.map(([group, tasks]) => ({
        key: group,
        label: (
          <Text strong style={{ fontSize: 13 }}>
            {group}
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {tasks.filter((t) => states[t.id] === 'success').length}/{tasks.length}
            </Text>
          </Text>
        ),
        children: tasks.map((task) => {
          const status: TaskStatus = states[task.id] ?? 'pending';
          const blocked = isBlocked(task, states);
          const { icon, color, label } = STATUS_ICON[status];

          return (
            <div
              key={task.id}
              data-testid={`task-row-${task.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
                opacity: blocked ? 0.5 : 1,
                cursor: blocked ? 'not-allowed' : 'default',
              }}
            >
              <Checkbox
                checked={selected.includes(task.id)}
                disabled={blocked}
                onChange={() => toggleTask(task.id)}
              />
              <Tooltip title={label}>
                <span style={{ color, fontSize: 16, lineHeight: 1, fontFamily: 'monospace' }}>{icon}</span>
              </Tooltip>
              <Text style={{ fontSize: 13 }}>{task.title}</Text>
              {status === 'failed' && <FailedTaskActions taskId={task.id} status={status} />}
            </div>
          );
        }),
      }))}
    />
  );
}
