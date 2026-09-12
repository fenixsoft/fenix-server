# Spec: dependency-rerun-fix

## ADDED Requirements

### Requirement: 已 success 任务默认不重跑

勾选下游任务或执行任务集时，已 success 的任务 SHALL 默认不纳入执行队列。前端级联勾选（cascade）SHALL 仅加入「状态非 success」的依赖任务；exec 动作 SHALL 仅在「全部重跑」开关开启时纳入已 success 任务；服务端 SHALL 同样过滤 status=success 的任务作为兜底（客户端行为不可信时的正确性保障）。

#### Scenario: 执行过的前置不再重跑

- **WHEN** 任务 A（无依赖）已执行 success，用户勾选依赖 A 的任务 B 并触发执行
- **THEN** 仅 B 被执行，A 不再进入队列（状态保持 success，无重新 running 事件）

#### Scenario: 级联勾选过滤 success 依赖

- **WHEN** 勾选依赖链末端任务，其中部分依赖已 success、部分 pending
- **THEN** 选中集含末端任务 + pending 依赖，不含已 success 依赖

#### Scenario: 全部重跑显式开启时才重跑

- **WHEN** 用户开启「全部重跑」开关后执行
- **THEN** 已 success 任务被纳入队列重新执行（状态 success → running → success）

### Requirement: runner 不再无条件重置全 manifest

服务端 `runner.run` SHALL 不再无条件把全部 manifest 任务重置为 pending；SHALL 仅影响本次执行队列涉及的任务（或按显式重跑语义重置），未执行任务的历史状态（success/skipped 等）SHALL 保留。

#### Scenario: 执行子集不抹掉历史状态

- **WHEN** 任务 A 已 success，随后执行任务 B（依赖 A 且 A 不重跑）
- **THEN** runner 启动后 A 的状态仍为 success（不被重置为 pending），B 正常执行

#### Scenario: 全量重跑才全重置

- **WHEN** 「全部重跑」触发全量执行
- **THEN** 全部任务重置 pending 后按拓扑顺序重新执行

### Requirement: 既有 e2e 语义更新

修改 runner 状态语义 SHALL 同步更新既有 e2e 测试（exec-flow.test.ts 等）断言：单次 exec 的「全部 pending 重置」假设改为「保留未执行任务历史状态」假设，新增「已 success 前置不重跑」回归场景。

#### Scenario: 回归测试覆盖重跑语义

- **WHEN** 运行执行 e2e 测试
- **THEN** 含新场景：先执行 A 成功，再执行依赖 A 的 B，断言 A 不重跑、B 成功