# Proposal: improve-execution-flow

## Why

实测执行流存在三类问题：①任务有依赖但 UI 无步骤导航，用户看不到执行到哪、下一步是什么；②只能逐个勾选执行，无「一键执行全部」入口；③执行日志用 react-window 纯文本行渲染，无法显示带 ANSI 转义/进度条的输出（部分安装任务依赖此）；④依赖处理语义错误——执行过的任务（success）在勾选其下游任务时会被级联重跑，且 `runner.run()` 会把全部任务重置 pending。前三个是执行体验缺口，第四个是正确性 bug。

## What Changes

- **Step 步骤导航**：任务视图顶部新增 antd Steps 导航条，按依赖拓扑顺序展示执行进度（当前运行 / 已完成 / 待执行）；左侧保留任务树用于勾选与任务详情。Step 状态由 taskStates 驱动，与执行进度实时联动。
- **一键执行全部**：执行工具栏新增「执行全部」按钮，按依赖拓扑执行全部可执行任务（完整闭包），免去逐步勾选等待。
- **xterm.js 执行日志**：执行日志 Tab 由 react-window 虚拟列表改为 xterm.js 终端渲染，直接消费 log 数据流写入终端，支持 ANSI 转义序列与进度条显示（复用既有 `@xterm/xterm` 依赖，与 ClaudeTerminal 同模式）。
- **依赖重跑语义修复**：已 success 的任务默认不再重跑——前端级联勾选过滤 success 依赖、exec 不再重置全部任务状态；服务端 `exec` 处理过滤 status=success 的任务（不纳入本次队列），`runner.run` 不再无条件重置全 manifest pending。工具栏新增「全部重跑」开关，开启时显式强制全量重跑。
- 校验承诺：manifest 下发（前一 spec）与单会话语义不变。

## Capabilities

### New Capabilities

- `execution-navigation`: 执行流步骤导航——antd Steps 导航条按拓扑顺序展示执行进度，与任务树/执行状态联动；含「执行全部」一键执行入口
- `terminal-log-view`: xterm.js 执行日志——用终端渲染执行输出流，支持 ANSI 转义/进度条，替代 react-window 纯文本行
- `dependency-rerun-fix`: 依赖重跑语义修复——已 success 任务默认不重跑（前端级联过滤 + 服务端 exec/runner 过滤），提供「全部重跑」显式开关

### Modified Capabilities

（无——全部归入上述新能力）

## Impact

- 前端：`web/src/views/TaskView.tsx`（Step 导航条落点）、`web/src/components/ExecutionToolbar.tsx`（执行全部/全部重跑按钮）、`web/src/components/LogViewer.tsx`（xterm 化）、`web/src/stores/appStore.ts`（cascade/exec 依赖过滤 + 全执行 + 重跑开关）、`web/src/components/TaskTree.tsx`（如有必要联动）
- 服务端：`server/engine/runner.ts`（run 不再无条件重置全 manifest；或新增选择性重置）、`server/handlers.ts`（exec 过滤 success 任务 + 全部重跑参数）
- 复用：`server/engine/planner.ts`（topoSort 生成执行顺序给 Step 导航与执行项）、`shared/messages.ts`（exec 消息可扩展 rerun 标记）、`@xterm/xterm`（已装）
- 不改 manifest 下发（`manifest` 消息）、单会话语义（`SESSION_EXISTS`）
- 注意：runner.run 当前语义「fresh run 重置全 manifest」被 e2e（exec-flow.test.ts）依赖，修改需同步更新既有测试断言