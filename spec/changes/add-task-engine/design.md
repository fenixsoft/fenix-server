# Design: add-task-engine

## Context

依赖 add-ssh-foundation 的产出（SshConnection、命令执行器、SFTP、shared 任务 schema 与消息类型）。执行模型在设计文档 §4.2 已定：单队列串行、失败停等、幂等由任务自身保证。本 SPEC 把这些语义落为可测试的引擎模块。

## Goals / Non-Goals

**Goals:**

- `manifest.ts`：`loadManifest(path)` 读 YAML → zod 校验 → 返回强类型清单或带任务定位的错误
- `planner.ts`：`detectCycle(tasks)`、`topoSort(selected, tasks)`（输出依赖就绪的执行序列）、`cascadeSelect(selected, tasks)`（补齐全部传递依赖）、`isBlocked(taskId, states)`（依赖未完成判定，供 UI 置灰）
- `runner.ts`：`TaskRunner` 类——`run(taskIds)` 生成队列并逐任务执行；每任务：SFTP 上传 `files` → 顺序 `exec` 每条 command（实时回调）→ `verify`（存在时）；状态事件与日志分片通过回调发射；失败即停等；`retry(taskId)` 重跑单任务、`skip(taskId)` 跳过并继续队列、`stop()` 终止当前命令并清空队列

**Non-Goals:**

- 多任务并行（设计明确单队列串行）
- Claude 修复流程（`fixing` 状态仅预留枚举与状态机位置，行为由 add-claude-fallback 接入）
- 断线自动恢复执行（SSH 断线时 runner 报告中断并停止，重连后由用户重新勾选执行）
- 代理注入（`needs_proxy` 环境变量注入由 add-proxy-tunnel 在 executor 包装层实现；本 SPEC 仅透传任务的 `needs_proxy` 标记）

## Decisions

1. **runner 状态机用显式枚举 + 集中转移函数**：`transition(taskId, event)` 内聚合法性检查（如 `skipped` 只能从 `failed/pending` 进入）。理由：状态语义是本 SPEC 的核心契约，集中管理便于单测穷举与前端对齐。
2. **执行队列在 `run()` 时一次性物化**：拓扑排序结果固化为数组，`skip` 后按序继续。理由：执行中清单不会变化（单用户单连接），物化避免重复排序的不确定性。
3. **日志与状态走 EventEmitter 风格回调，消息封装留给 ws 层**：runner 只发领域事件（`task-state`、`log`、`progress`、`queue-finished`），由 add-ssh-foundation 的 ws 路由器订阅转译为 WebSocket 消息。理由：引擎不依赖传输层，可独立单测。
4. **失败任务的「停在失败处」实现为 runner 进入 `awaiting-decision` 暂停态**：不销毁队列，`retry`/`skip` 决策驱动继续。理由：与设计文档"引擎停在失败处，界面提示三动作"一致。
5. **verify 失败等同命令失败**：verify 退出码非 0 → 任务 failed（错误上下文标注 verify 阶段）。理由：设计文档明确"确认真实生效；失败同样判任务失败"。
6. **files 上传失败即任务失败**（不上传任何命令）。理由：命令依赖这些文件，提前失败避免半执行状态。

## Risks / Trade-offs

- [长任务（apt install）执行中 WebSocket 断开导致前端丢事件] → runner 事件与 ws 解耦后，可在 ws 重连时全量补发当前快照（本 SPEC 提供 `snapshot()`，补发由 add-web-ui 消费）
- [「停止」终止命令依赖 channel close 的语义差异（远端进程可能残留）] → 执行器 close channel 并记录告警日志；文档标注残留风险，不引入远端 pkill 复杂度
- [任务自身不幂等导致重试副作用] → 引擎文档明确约定：清单作者必须保证命令幂等（`-y`、先备份后覆盖），引擎不做检测（设计已定）

## Migration Plan

全新模块，无迁移。

## Open Questions

无。
