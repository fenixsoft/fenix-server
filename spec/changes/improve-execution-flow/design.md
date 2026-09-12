# Design: improve-execution-flow

## Context

add-manifest-delivery 已让前端拿到真实 17 任务清单与依赖图，暴露三个执行体验缺口（无步骤导航、无全执行、日志是纯文本）与一个正确性 bug（依赖重跑）。现状：左树右 Tab（TaskView 双栏）、LogViewer 用 react-window、cascade 无 success 过滤、`runner.run` 无条件 reset 全 manifest。

## Goals / Non-Goals

**Goals:**

- 顶部 Steps 导航条（topoSort 顺序，taskStates 驱动状态），与左树并存
- 「执行全部」按钮 + 「全部重跑」开关
- LogViewer xterm 化，支持 ANSI/进度条
- 已 success 任务默认不重跑（前端级联 + 服务端兜底双保险），全重跑显式开启才重跑

**Non-Goals:**

- 不改 manifest 下发协议、单会话语义、runner 执行状态机（除 reset 语义）
- 不重做任务树为 Steps（保留树，导航条是增量）
- 不改 Claude 终端的 xterm 实例

## Decisions

1. **Steps 用 topoSort 线性化 + 左树并存**：manifest 是 DAG 有分支，Steps 单链按 `planner.topoSort(全量任务)` 稳定拓扑序排；每 Step 对应一个任务（同名显示）。分支任务都会出现，只是不表达「同层并行」——导航语义以「下一步要跑什么」为主，分支细节由左树承载。
2. **「执行全部」= topoSort 全量闭包 + 过滤 success**：点击后 target = 全部任务 id，经「过滤已 success」→ cascade 闭包 → exec。与单任务勾选走同一依赖过滤逻辑，避免两套语义。
3. **依赖过滤双层**：
   - 前端 `cascade()` 改为只 add `status !== 'success'` 的依赖；`exec()` 的「重置全 pending」删除，改为仅重置本次队列任务的状态。
   - 服务端 `handleExec` 过滤掉 `status === 'success'` 的 taskIds（除非 exec payload 带 `rerun: true`）；`runner.run(taskIds, {reset})` 不再无条件 reset 全 manifest——仅 reset 传入闭包内任务，未执行任务保留历史状态。
   - 「全部重跑」开关 → `exec` payload 带 `rerun: true` → 服务端纳入 success 任务 + runner 全 reset。
4. **xterm 日志**：LogViewer 重写为一个 xterm 实例容器，订阅 logLines 增量（或改用 log 消息直写流），`term.write(data)` 保留 ANSI；命令 header 写入为分隔行（无 exit-code 徽标的纯文本样式）。复用 `@xterm/xterm` + fit addon（与 ClaudeTerminal 一致）。环形缓冲上限沿用 5000 行（超出丢弃最旧，xterm 不支持截断历史则清屏重建）。
5. **全执行/重跑按钮落点 ExecutionToolbar**：现有「全选/清空/执行选中/停止」右侧加「执行全部」与「全部重跑」开关（Switch）；执行中禁用全执行。

## Risks / Trade-offs

- [xterm 历史截断] → xterm 无内置截断，用「滚动缓冲 > N 行时整屏清空重写最近 N 行」策略，避免内存膨胀
- [runner reset 语义变更破坏既有测试] → dependency-rerun-fix spec 明确要求同步更新 exec-flow.test.ts；全量回归确认
- [Steps 线性化误导用户以为串行] → 左树保留分支真相；Steps tooltip 标注该步所属 group 与依赖已满足说明

## Migration Plan

纯前端 UI 重构 + 前后端执行语义修正。无数据迁移。runner.run 签名扩 `options?: { reset?: boolean }`（缺省保留旧 reset 语义或按新语义？——取「新语义：仅闭包内重置」为缺省，规避用户手动执行时历史状态被抹）。

## Open Questions

无。