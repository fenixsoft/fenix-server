# Design: add-ws-handlers

## Context

`server/ws.ts` 已交付 MessageRouter 路由骨架（register/dispatch、未知类型回 error、非法 JSON 容错），`server/index.ts` 建服时创建了空 router 但从未注册 handler。全部后端引擎已就绪且均不依赖传输层：

- `SshConnection`（密码认证、状态机、事件）、`SshExecutor`/`SshSftp`（执行/上传，满足 runner 的 `CommandExecutor`/`FileUploader` 注入接口）
- `TaskRunner`（事件：task-state/log/progress/stopped-state/queue-finished；retry/skip/stop/fix/snapshot）
- `ClaudeFixer`（事件：claude-output 等；start/write/abort；隧道开启时自动注入代理 env）
- `TunnelManager`（open/close/testConnectivity；status 事件）
- `AppConfigManager`（config.json 服务器列表与 clientProxy）
- `loadManifest`（YAML → schema 校验 → 结构化错误）

add-web-ui 前端按 `shared/messages.ts` 契约发送 11 种 ClientMessage 并消费 7 种 ServerMessage；验证 24/32 场景因「未知的消息类型: connect」失败。本 SPEC 是传输层与引擎间的最后一块粘合。

## Goals / Non-Goals

**Goals:**

- 新建 `server/handlers.ts`：`registerSessionHandlers(router, deps)` 一次性注册全部 11 种消息 handler
- 会话上下文（SessionContext）：单客户端语义下的 SshConnection/TaskRunner/ClaudeFixer/TunnelManager 生命周期与互斥（重建前必须先清理）
- 事件翻译层：engine 事件 → ServerMessage 的统一广播（含多订阅者容错：单 socket 断开不影响其他消息派发）
- 快照语义：connect 后、snapshot 请求后、stop 后均为前端提供全量一致状态
- 清单来源：connect payload 可选自定义 YAML 文本；缺省加载 `assets/tasks.yaml`（与 add-builtin-tasks-e2e 交付对齐）
- 全部 handler 单元测试（注入 fake 引擎）+ 真实 SSH 集成测试（docker compose 测试容器）

**Non-Goals:**

- 修改 `shared/messages.ts` 消息契约（11+7 种类型保持不变）
- 多客户端并发会话、鉴权、跨进程状态持久化（单用户本地工具，单会话语义）
- 修改 `web/` 前端任何代码
- 改动引擎/SSH 层内部实现（仅组装）

## Decisions

1. **handler 装配独立成 `server/handlers.ts` 而非内联 index.ts**：index.ts 已承担建服/静态托管/优雅退出；装配层有独立的会话状态机（连接互斥、清理顺序、事件绑定解绑），独立文件可被测试直接驱动（router.dispatch 喂消息、断言 send 序列），不必起 HTTP。
2. **单会话（single-session）语义**：同一时刻至多一个 SSH 会话；新 connect 到达时若已有活跃会话则拒绝（回 error）而非静默替换——前端断开必然发 disconnect 或断 ws（两者都触发清理），拒绝语义可暴露前端状态机 bug 而非掩盖。
3. **清单来源优先级**：connect.payload 携带 YAML 文本 → 前端 custom 语义；否则服务端读 `assets/tasks.yaml` → 内置语义。前端内置清单仅是「代表性子集」（appStore.ts BUILTIN_MANIFEST），真正的内置全集以服务端 `assets/tasks.yaml` 为准，connect 成功后以服务端快照覆盖前端任务树（快照含全部 task-state，前端以 taskId 对齐）。
4. **事件翻译集中在 SessionContext 内一处绑定**：runner.on('task-state') → broadcast({type:'task-state'}) 等一一映射；绑定引用保存在会话上下文中，清理时统一 removeAllListeners + off，避免跨会话监听器泄漏。
5. **错误码沿用 payload.code 约定**：AUTH_FAILED / UNREACHABLE / TIMEOUT / CLAUDE_UNAVAILABLE / SESSION_EXISTS / NO_SESSION / BLOCKED_TASK / MANIFEST_INVALID，与前端可区分错误呈现对齐。
6. **stop 后快照补发**：runner `stopped-state` 事件携带的快照翻译为逐任务 task-state + progress 重放，前端无需新消息类型即可复位。

## Risks / Trade-offs

- [单会话拒绝可能误伤前端异常重连场景] → disconnect 幂等 + ws close 兜底清理，双路径保证旧会话必然释放；error 消息含 SESSION_EXISTS 码便于前端提示
- [引擎事件异步派发与 socket 发送交错] → broadcast 前检查 readyState，消息按序同步发送；runner 事件本身串行
- [自定义 YAML 较大] → connect 消息一次性携带文本（典型清单 < 100KB），schema 校验失败即拒，无落盘需求（会话内存持有）

## Migration Plan

纯增量：新文件 handlers.ts + index.ts 装配点替换（空 router → 注册后的 router）。无数据迁移。

## Open Questions

无。
