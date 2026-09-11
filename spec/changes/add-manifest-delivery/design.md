# Design: add-manifest-delivery

## Context

add-web-ui 前端任务树渲染硬编码 `BUILTIN_MANIFEST`（10 个代表性子集），服务端则执行 `assets/tasks.yaml`（17 个真实任务）。add-ws-handlers 的 connect 快照只下发 task-state（id+pending），协议无 manifest 定义通道，导致任务树/置灰错位、执行返回「未知任务 id」且该 error 在任务视图不可见（存 lastError 仅连接视图展示）。本 SPEC 补 protocol 通道 + 前端覆盖 + e2e 执行验证。

## Goals / Non-Goals

**Goals:**

- `shared/messages.ts` 新增 `manifest` ServerMessage（payload 复用 TaskManifest）
- 服务端 `sendManifestSnapshot` 先 manifest 后 task-state；snapshot 补发同样先 manifest
- 前端 `applyServerMessage` 新增 manifest 分支：覆盖 manifest、重建 taskStates/勾选/进度/日志、保持连接态
- 任务视图 error 可见化（执行区全局错误出口，成功动作发起时清除）
- e2e：真实 SSH 容器的执行链路 + 失败决策态覆盖

**Non-Goals:**

- 不改 TaskManifest schema（复用 shared/schema.ts）
- 不改 runner/fixer/tunnel 引擎
- 不引入前端多清单管理 UI（沿用内置/自定义二选一）

## Decisions

1. **manifest 独立 ServerMessage 而非塞进 connection-status**：连接状态与清单数据解耦；前端可独立订阅处理，重连 snapshot 复用同一消息；后续多清单/清单刷新天然复用。
2. **下发顺序 = manifest → task-state**：前端先有清单定义（taskId→requires 闭合）再消费状态流，避免 task-state 到达时 manifest 未就绪导致的「先有状态无定义」竞态。
3. **前端覆盖而非合并**：收到 manifest 即以服务端清单整体替换本地 BUILTIN_MANIFEST（服务端为准），重建 taskStates 为全 pending、清空勾选/进度/日志；不重置 sshStatus（连接已建立，仅清单视图重建）。
4. **error 落点 = 执行区全局提示**：在 TaskView 顶部（或 ExecutionToolbar 上方）渲染 lastError，`error` 消息 set lastError；handleConnect/handleExec 等成功动作发起时 set lastError=null。复用 antd Alert/message，不新增状态字段。
5. **e2e 失败任务用 fixture 清单**：`tests/e2e/fixtures/exec-flow-tasks.yaml` 含 `echo-ok`（echo + verify 通过）与 `fail-always`（`exit 1`）两个任务；e2e 通过自定义 YAML 路径加载该清单（前端本地解析 + 服务端同步解析），测失败→重试/跳过。不用内置 17 任务清单测失败（避免依赖真实网络/软件源副作用）。

## Risks / Trade-offs

- [manifest 消息体积] → 17 任务清单序列化后 < 20KB，单帧下发无压力；未来大清单可增分片，当前不做
- [前端覆盖时机的 task-state 竞争] → 服务端严格先 manifest 后 task-state 顺序保证；前端 manifest 分支先落库，后续 task-state 逐条覆盖
- [e2e 依赖 SSH 容器] → 复用 docker-compose.test.yml（fenix-sshd-test，宿主 2222 root/testpass123）；测试前置确认容器在跑，缺则提示

## Migration Plan

纯增量：新消息类型 + 服务端下发顺序调整 + 前端分支 + e2e fixture。无数据迁移；旧客户端（无 manifest 分支）忽略未知消息类型照常工作（前端 isServerMessage 需含新类型）。

## Open Questions

无。