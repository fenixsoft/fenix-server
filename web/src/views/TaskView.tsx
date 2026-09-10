/**
 * web/src/views/TaskView.tsx
 *
 * Task execution view (shown after connection established).
 *
 * Follows design doc §8 ASCII layout:
 * ┌────────┬────────────────────────────────────────────────┐
 * │ Toolbar│  Tabs: 执行日志 | 任务详情 | Claude修复         │
 * │  Tree  │                                                │
 * └────────┴────────────────────────────────────────────────┘
 */
import { Tabs } from 'antd';
import ExecutionToolbar from '../components/ExecutionToolbar';
import TaskTree from '../components/TaskTree';
import LogViewer from '../components/LogViewer';
import TaskDetailPanel from '../components/TaskDetailPanel';
import ClaudeTerminal from '../components/ClaudeTerminal';
import { useAppStore } from '../stores/appStore';

export default function TaskView() {
  const manifest = useAppStore((s) => s.manifest);
  const taskStates = useAppStore((s) => s.taskStates);
  const focusedTaskId = useAppStore((s) => s.focusedTaskId);

  const focusedTask = focusedTaskId
    ? manifest?.tasks.find((t) => t.id === focusedTaskId) ?? null
    : null;
  const focusedStatus = focusedTaskId ? (taskStates[focusedTaskId] ?? 'pending') : 'pending';

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: toolbar + tree */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          padding: 8,
          gap: 8,
        }}
      >
        <ExecutionToolbar />
        <TaskTree />
      </div>

      {/* Right: three-tab main area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Tabs
          defaultActiveKey="log"
          style={{ height: '100%' }}
          tabBarStyle={{ paddingLeft: 16 }}
          items={[
            {
              key: 'log',
              label: '执行日志',
              children: <LogViewer />,
            },
            {
              key: 'detail',
              label: '任务详情',
              children: <TaskDetailPanel task={focusedTask} status={focusedStatus} />,
            },
            {
              key: 'claude',
              label: '⚡ Claude修复',
              children: <ClaudeTerminal />,
            },
          ]}
        />
      </div>
    </div>
  );
}
