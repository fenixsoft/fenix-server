# Spec: execution-planner

## ADDED Requirements

### Requirement: 依赖环检测

系统 SHALL 在规划前检测 `requires` 构成的依赖图是否存在环；存在环时 SHALL 报错并给出环上的任务 id 序列，SHALL NOT 产出执行队列。

#### Scenario: 无环清单通过

- **WHEN** 检测 A→B→C 的依赖链
- **THEN** 无环，检测通过

#### Scenario: 环依赖报错并给出环路径

- **WHEN** 任务 A 依赖 B、B 依赖 C、C 依赖 A
- **THEN** 检测失败，错误中给出 A→B→C→A（或等价）环路径

### Requirement: 拓扑排序生成执行队列

给定选中任务集合与全部任务，系统 SHALL 产出满足依赖先序的串行执行队列：任何任务在队列中位于其全部依赖之后；选中任务的全部传递依赖 SHALL 包含在队列中。

#### Scenario: 队列满足依赖先序

- **WHEN** 选中 C（依赖 B，B 依赖 A）
- **THEN** 队列顺序为 A、B、C

#### Scenario: 无依赖关系的任务保持声明顺序

- **WHEN** 选中互不依赖的 X、Y（声明顺序 X 在前）
- **THEN** 队列保持 X、Y 顺序

### Requirement: 勾选级联与可执行判定

系统 SHALL 提供级联勾选计算：勾选任一任务自动补齐其全部传递依赖；SHALL 提供任务可执行判定：任一直接依赖未处于完成态时该任务 SHALL 判定为被阻塞（供 UI 置灰）。

#### Scenario: 级联勾选补齐传递依赖

- **WHEN** 勾选 C（依赖链 C→B→A）
- **THEN** 选中集合自动包含 A 与 B

#### Scenario: 依赖未完成时任务被阻塞

- **WHEN** 任务 B 依赖 A 且 A 未成功完成
- **THEN** B 判定为阻塞态
