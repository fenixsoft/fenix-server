# Spec: fix-workflow

## ADDED Requirements

### Requirement: 修复触发与上下文提示词

失败任务的「交给 Claude 修复」动作 SHALL 触发修复编排；提示词 SHALL 包含：任务标题与描述、失败阶段与失败命令原文、错误输出尾部（上限 8KB，截头留尾）、`claude_hint`（存在时）；任务状态 SHALL 先置为 fixing。

#### Scenario: 提示词内容完整

- **WHEN** 对含 claude_hint 的失败任务触发修复（mock claude 记录 prompt）
- **THEN** 提示词含任务描述、失败命令、错误输出尾部与 hint 文本

#### Scenario: 触发后状态为 fixing

- **WHEN** 修复会话启动
- **THEN** 任务状态变为 fixing 且有状态事件

### Requirement: 修复后自动重跑与状态回归

claude 进程正常退出后系统 SHALL 自动重跑该任务完整步骤（复用 retry 语义）：重跑成功 SHALL 置 success 并继续执行队列中其余任务；重跑仍失败 SHALL 回到 failed 并可再次修复或跳过；修复会话被中止（用户终止或 PTY 异常）SHALL 将任务置回 failed。

#### Scenario: 修复成功后队列继续

- **WHEN** mock claude 修复场景下退出（退出码 0）且重跑成功
- **THEN** 任务变 success，队列中后续任务自动开始

#### Scenario: 重跑仍失败可再决策

- **WHEN** claude 退出后重跑仍失败
- **THEN** 任务回 failed，重试/修复/跳过动作重新可用

#### Scenario: 中止修复回退失败态

- **WHEN** 修复会话运行中被用户中止
- **THEN** 任务回 failed，会话资源被清理

### Requirement: 单修复会话约束

同一时刻 SHALL 最多存在一个修复会话；已有会话时新修复请求 SHALL 被拒绝并提示当前正修复的任务。

#### Scenario: 并发修复请求被拒

- **WHEN** 修复会话进行中触发另一任务的修复
- **THEN** 请求被拒绝，错误指明当前修复中的任务
