# Proposal: add-manifest-delivery

## Why

add-web-ui 交付后，实测发现任务视图与后端任务清单严重脱节：前端任务树渲染的是硬编码的 `BUILTIN_MANIFEST`（10 个「代表性子集」，id 如 `setup-proxy`/`install-tools`），而服务端真实清单 `assets/tasks.yaml` 有 17 个任务（id 如 `install-clash`/`install-base-tools`）。连接后的快照只下发 17 个 `task-state`（id + pending），**从未下发任务定义**（title/group/requires/commands），前端只能退回硬编码子集。后果：任务树只显示 2 个无依赖任务可选、其余错误置灰；勾选执行后前端发 `exec{setup-proxy}`，服务端回「未知任务 id」，而该 error 又被存入 `lastError` 仅在连接视图展示——用户在任务视图点击执行「没反应」。这与此前 connect handler 零接线同属跨 SPEC 集成缺口：协议缺一条 manifest 下发通道。

## What Changes

- `shared/messages.ts` 新增 ServerMessage 类型：`{ type: 'manifest', payload: { manifest: TaskManifest } }`（TaskManifest 复用 shared/schema.ts 既有类型）
- `server/handlers.ts`：`sendManifestSnapshot()` 在下发 task-state 快照**之前**先广播 `manifest` 消息（携带本次会话实际解析出的 manifest——内置清单或 connect 携带的自定义 YAML，二者已由 resolveManifest 统一）
- `web/src/stores/appStore.ts`：`applyServerMessage` 新增 `case 'manifest'`——用服务端清单覆盖当前 manifest、按新任务集重建 taskStates/勾选集/进度，并保持已连接态；`snapshot` 补发路径同样先期待 manifest 再重建
- 任务视图错误可见化：新增执行区全局错误提示（`lastError` 从仅 ConnectionView 展示改为任务视图亦有可见出口），`error` 消息（未知任务 id/BLOCKED_TASK/NO_SESSION 等）不再静默丢失
- e2e 测试：补齐「执行链路」真实 SSH 验证——连接 → 看到 17 任务真实清单 → 勾选无依赖任务执行 → 状态 pending→running→success + 日志 + 进度；含失败任务 → 决策态 → 重试/跳过

## Capabilities

### New Capabilities

- `manifest-delivery`: manifest 下发协议——connect/快照时服务端下发真实任务清单，前端接收并覆盖本地清单、重建任务视图状态
- `exec-e2e`: 执行链路端到端测试——真实 SSH 容器上的勾选/执行/状态迁移/日志/进度/失败决策态验证

### Modified Capabilities

（无——manifest 下发作为整体新能力交付；shared-contracts 的消息契约扩充与 app-shell 的 manifest 处理均归入其上）

## Impact

- 修改文件：`shared/messages.ts`、`server/handlers.ts`、`web/src/stores/appStore.ts`、`web/src/views/TaskView.tsx`（或等价错误展示组件）、`web/src/components/ExecutionToolbar.tsx`（错误展示落点）
- 新增测试：`web/src/stores/appStore.test.ts`（manifest 覆盖分支）、`tests/e2e/exec-flow.test.ts`（执行链路 e2e）
- 复用（不修改）：`server/engine/runner.ts`、`server/engine/manifest.ts`、`assets/tasks.yaml`、`tests/e2e/e2e.test.ts` 既有基础设施（docker-compose.e2e.yml / Dockerfile.sshd，基底 ubuntu:24.04、root/testpass123、宿主 2222）
- 产物契约不新增 TaskManifest 定义（复用 shared/schema.ts），仅新增其传输通道
- 依赖：add-ws-handlers（SessionContext/manifest 解析已就绪）、add-web-ui（前端 store/task 树既有结构）