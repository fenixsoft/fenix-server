# Spec: execution-runner

## ADDED Requirements

### Requirement: 串行执行队列与任务内步骤

系统 SHALL 按执行队列逐任务串行执行；每个任务依次：上传其 `files` 声明的全部资源文件（目标 `/root/server-init/` 保持相对路径）→ 顺序执行 `commands` 每一条 → 存在 `verify` 时执行验证命令。任一环节失败 SHALL 立即终止该任务后续步骤并进入失败处理。

#### Scenario: 完整任务成功流转

- **WHEN** 执行一个含 files、两条 commands、verify 的任务且全部成功
- **THEN** 任务状态依次经历 running 到 success，verify 在 commands 之后执行

#### Scenario: 命令失败终止后续命令

- **WHEN** 任务第二条命令退出码非 0
- **THEN** 第三条命令不被执行，任务进入 failed

#### Scenario: 文件上传失败即任务失败

- **WHEN** 任务声明的某文件上传失败
- **THEN** 不执行任何 command，任务进入 failed

#### Scenario: verify 失败判任务失败

- **WHEN** commands 全部成功但 verify 退出码非 0
- **THEN** 任务进入 failed 且错误上下文标注 verify 阶段

### Requirement: 实时状态与日志事件

执行过程中系统 SHALL 实时发射事件：任务状态变更（task-state）、输出分片（log，含任务 id、stdout/stderr 标记、数据）、整体进度（完成数/总数）；事件发射 SHALL 先于后续步骤推进（不缓冲整任务结束后批量发出）。

#### Scenario: 输出实时发射

- **WHEN** 一条长输出命令执行中
- **THEN** 输出分片随产生即发射，非命令结束后一次性发出

#### Scenario: 进度事件反映完成数

- **WHEN** 队列 3 个任务完成 2 个
- **THEN** progress 事件报告 2/3

### Requirement: 失败停等与用户决策

任务失败时 runner SHALL 停在失败处等待决策（不自动继续队列）：`retry` 重跑该任务完整步骤；`skip` 将该任务标记 skipped 并继续队列中其余任务；`stop` 终止当前命令并将全部未开始任务复位为 pending、清空队列。

#### Scenario: 失败后队列暂停

- **WHEN** 队列 [A, B, C] 中 B 失败
- **THEN** C 不开始执行，B 停留在 failed 等待决策

#### Scenario: 重试失败任务成功后继续

- **WHEN** B 失败后执行 retry 且重跑成功
- **THEN** B 变为 success 且 C 自动开始执行

#### Scenario: 跳过后继续不依赖它的任务

- **WHEN** B 失败后执行 skip（C 不依赖 B）
- **THEN** B 标记 skipped，C 继续执行

#### Scenario: 停止复位队列

- **WHEN** 执行中调用 stop
- **THEN** 当前命令被终止，未开始任务回到 pending，队列清空

### Requirement: 执行快照

系统 SHALL 提供当前执行快照查询：全部任务最新状态、当前执行任务、进度；用于断线重连后的状态补发。

#### Scenario: 快照反映实时状态

- **WHEN** 队列执行到第 2 个任务时查询快照
- **THEN** 快照含全部任务状态与当前任务标识
