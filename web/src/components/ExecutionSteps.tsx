/**
 * web/src/components/ExecutionSteps.tsx
 *
 * 步骤导航条（execution-navigation SPEC）：任务视图顶部按依赖拓扑顺序
 * （topoSort 线性化）展示全部任务的执行进度。
 *
 *   - Steps 单链顺序 = `topoOrder(全量任务)`：依赖先行、同层按声明序稳定
 *     （镜像 server/engine/planner.ts 的 Kahn 算法，保证与 runner 队列顺序一致）。
 *   - 每个 Step 对应一个任务，状态由 taskStates 驱动：
 *       success → finish（已完成）、running → process（当前执行）、其余 → wait。
 *   - Tooltip 标注任务所属 group 与依赖满足情况（分支细节由左树承载，
 *     Steps 只表达「下一步要跑什么」）。
 *
 * 纯展示组件：不发送任何消息，仅投影 store 的 manifest + taskStates。
 */
import { useMemo } from 'react';
import { Steps, Tooltip, theme } from 'antd';
import { useAppStore } from '../stores/appStore';
import type { Task } from '@fenix/shared/schema';
import type { TaskStatus } from '@fenix/shared/messages';

// ---------------------------------------------------------------------------
//  拓扑排序（前端镜像 server/engine/planner.ts 的 topoSort）
// ---------------------------------------------------------------------------

/**
 * 全量任务拓扑序：Kahn 算法，就绪集按声明序稳定排序。
 * 依赖任务排在其依赖者之前；存在环时返回空数组（由调用方降级为不渲染）。
 */
export function topoOrder(tasks: ReadonlyArray<Task>): string[] {
  if (tasks.length === 0) return [];
  const declIndex = new Map(tasks.map((t, i) => [t.id, i]));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    for (const dep of t.requires) {
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      if (!children.has(dep)) children.set(dep, []);
      children.get(dep)!.push(t.id);
    }
  }

  const ready: string[] = [];
  for (const t of tasks) {
    if ((indegree.get(t.id) ?? 0) === 0) ready.push(t.id);
  }
  ready.sort((a, b) => declIndex.get(a)! - declIndex.get(b)!);

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of children.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) {
        ready.push(next);
        ready.sort((a, b) => declIndex.get(a)! - declIndex.get(b)!);
      }
    }
  }
  // 环检测：产出不足说明可达子图含环，无合法线性化。
  return order.length === tasks.length ? order : [];
}

// ---------------------------------------------------------------------------
//  组件
// ---------------------------------------------------------------------------

/** 步骤状态映射：success→finish / running→process / 其余→wait。 */
function stepStatusOf(status: TaskStatus): 'finish' | 'process' | 'wait' {
  if (status === 'success') return 'finish';
  if (status === 'running') return 'process';
  return 'wait';
}

export default function ExecutionSteps() {
  const manifest = useAppStore((s) => s.manifest);
  const taskStates = useAppStore((s) => s.taskStates);
  const { token } = theme.useToken();

  const steps = useMemo(() => {
    if (!manifest || manifest.tasks.length === 0) return [];
    const order = topoOrder(manifest.tasks);
    return order.map((id) => {
      const task = manifest.tasks.find((t) => t.id === id);
      if (!task) return null;
      const status: TaskStatus = taskStates[task.id] ?? 'pending';
      const depsOk = (task.requires ?? []).every((dep) => taskStates[dep] === 'success');
      return { task, status: stepStatusOf(status), depsOk };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
  }, [manifest, taskStates]);

  if (steps.length === 0) return null;

  return (
    <div
      style={{
        padding: '8px 16px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        overflowX: 'auto',
      }}
      data-testid="execution-steps"
    >
      <Steps
        size="small"
        responsive={false}
        items={steps.map(({ task, status, depsOk }) => ({
          status,
          title: (
            <Tooltip
              title={
                <>
                  <b>{task.title}</b>
                  <div>分组：{task.group ?? '未分组'}</div>
                  <div>依赖：{(task.requires ?? []).length > 0 ? task.requires.join('、') : '无'}</div>
                  <div>依赖已满足：{depsOk ? '是' : '否'}</div>
                </>
              }
            >
              <span
                data-testid={`step-title-${task.id}`}
                style={{
                  display: 'inline-block',
                  maxWidth: 132,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  verticalAlign: 'bottom',
                  fontSize: 12,
                }}
              >
                {task.title}
              </span>
            </Tooltip>
          ),
        }))}
      />
    </div>
  );
}