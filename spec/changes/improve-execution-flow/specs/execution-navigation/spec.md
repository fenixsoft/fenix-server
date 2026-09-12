# Spec: execution-navigation

## ADDED Requirements

### Requirement: 步骤导航条

任务视图顶部 SHALL 提供 antd Steps 导航条，按依赖拓扑顺序（topoSort 结果）展示全部任务执行进度；每个 Step 对应一个任务，状态由 taskStates 驱动：success → finish（已完成）、running → process（当前执行）、其余 → wait（待执行）。导航条 SHALL 与左侧任务树并存（树保留勾选与详情），不与树互斥。

#### Scenario: 连接后展示完整步骤

- **WHEN** 连接成功且任务清单下发（manifest）后
- **THEN** 顶部 Steps 展示与清单任务数一致的步骤，全部为 wait 状态

#### Scenario: 执行中步骤实时推进

- **WHEN** 任务开始执行（进入 running）
- **THEN** 对应 Step 变为 process（当前），已 success 的 Step 变为 finish，其余保持 wait

#### Scenario: 依赖顺序与 Steps 一致

- **WHEN** 查看 Steps 顺序
- **THEN** Steps 顺序与任务依赖拓扑排序一致（依赖任务排在依赖其的任务之前）

### Requirement: 一键执行全部

执行工具栏 SHALL 提供「执行全部」按钮：点击后按依赖拓扑执行全部可执行任务（完整依赖闭包，跳过已 success 任务——与 dependency-rerun-fix 语义一致）；执行期间按钮 SHALL 禁用防重复触发；执行全部 SHALL 复用现有 exec 消息与 runner 队列语义。

#### Scenario: 一键执行全部任务

- **WHEN** 连接后点击「执行全部」
- **THEN** 全部任务按拓扑顺序进入 running → success 流程，进度 completed/total 覆盖全部任务

#### Scenario: 执行中按钮禁用

- **WHEN** 执行进行中
- **THEN** 「执行全部」按钮禁用，避免重复触发

#### Scenario: 全部重跑开关生效

- **WHEN** 开启「全部重跑」开关后点击「执行全部」
- **THEN** 已 success 的任务也被纳入队列重新执行（不跳过）