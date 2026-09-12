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
import { Alert, Tabs } from 'antd';
import ExecutionSteps from '../components/ExecutionSteps';
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
  const lastError = useAppStore((s) => s.lastError);

  const focusedTask = focusedTaskId
    ? manifest?.tasks.find((t) => t.id === focusedTaskId) ?? null
    : null;
  const focusedStatus = focusedTaskId ? (taskStates[focusedTaskId] ?? 'pending') : 'pending';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* 执行区全局错误出口：服务端 error 消息（未知任务 id / BLOCKED_TASK /
          NO_SESSION 等）在此可见，用户据此定位「执行选中无反应」类静默失败。
          生命周期由 store 契约保证：下次成功动作（connect/exec/stop 等）发起时清除。 */}
      {lastError && (
        <Alert
          type="error"
          message={lastError}
          showIcon
          style={{ margin: 8, marginBottom: 0 }}
        />
      )}

      {/* 步骤导航条：按依赖拓扑顺序展示执行进度（错误条之下、左树+右 Tab 之上）。
          与左树并存 —— 树保留勾选与详情，Steps 只表达执行进度。 */}
      <ExecutionSteps />

      {/* Left + Right 横向布局：任务树在左、三页签在右（设计文档 §8 双栏）。 */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
    </div>
  );
}
