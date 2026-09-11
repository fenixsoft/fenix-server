# Proposal: add-ws-handlers

## Why

add-web-ui 前端已完整交付（16 测试 135 用例通过），但其验证 24/32 场景因服务端 WebSocket handler 零接线而失败：`server/ws.ts` 的 `MessageRouter` 只有路由骨架，`server/index.ts` 从未注册 `connect/exec/stop/retry/skip/fixWithClaude/pty-input/tunnel-open/tunnel-test/disconnect/snapshot` 的任何 handler，浏览器发来的消息全部得到「未知的消息类型」。前序 SPEC（add-ssh-foundation/add-task-engine/add-proxy-tunnel/add-claude-fallback）交付的全部后端能力（SshConnection、TaskRunner、TunnelManager、ClaudeFixer）至今没有被任何传输层组装。本 SPEC 补上这层粘合：把 ws 消息协议接到已有引擎上，让前端可实际操作工具。

## What Changes

- 新建 `server/handlers.ts`：ws 消息 handler 装配层——把 `shared/messages.ts` 的 11 种 ClientMessage 逐个注册到 MessageRouter：
  - `connect` → 创建/复用 `SshConnection`（密码认证），状态机事件翻译为 `connection-status`；连接成功后按当前清单物化任务集，下发快照
  - `exec/stop/retry/skip` → 驱动 `TaskRunner`（run/stop/retry/skip），runner 的 `task-state/log/progress/stopped-state/queue-finished` 事件翻译为对应 ServerMessage 广播
  - `fixWithClaude` → 驱动 `ClaudeFixer.start()`（隧道开启时自动注入代理 env），`claude-output` 事件转发；修复完成联动 runner 重跑
  - `pty-input` → 写入 Claude PTY 会话 stdin（无活跃会话时报 error）
  - `tunnel-open/tunnel-test` → 驱动 `TunnelManager.open()/testConnectivity()`，`status` 事件翻译为 `tunnel-status`；测试结果经 `tunnel-status` 回传出口 IP 或失败原因
  - `disconnect` → 关闭 SSH 连接、终止 runner/fixer/tunnel，清理全部会话资源
  - `snapshot` → 回发当前任务状态/进度/隧道状态全量（断线重连补发用）
- 修改 `server/index.ts`：在 buildServer 中装配真实 handler 集（单连接会话上下文：connection/runner/fixer/tunnel 生命周期管理，随 ws 断开或 disconnect 清理）
- runner 需要的任务清单来源：优先使用前端已加载的内置清单或自定义 YAML（通过 ws 传清单内容），与前端 `manifestSource` 语义对齐；`assets/tasks.yaml` 作为服务端内置兜底
- 消息契约不新增不修改（`shared/messages.ts` 保持不变）；能力语义全部来自既有 SPEC，本 SPEC 不引入新协议

## Capabilities

### New Capabilities

- `ws-session-handlers`: WebSocket 会话 handler 装配——11 种 ClientMessage 到既有引擎的完整接线、单会话资源生命周期（连接/清理）、runner 与 fixer 事件到 ServerMessage 的翻译广播、快照补发

### Modified Capabilities

（无——既有能力的需求不变；service-foundation 的「消息路由」需求由本 SPEC 在实现层补全，路由机制本身已交付）

## Impact

- 新增文件：`server/handlers.ts`（handler 装配与会话上下文）及其测试
- 修改文件：`server/index.ts`（装配真实 handler）、`server/package.json`（如需补依赖）
- 复用（不修改）：`server/ssh/connection.ts`、`server/ssh/executor.ts`、`server/ssh/sftp.ts`、`server/ssh/tunnel.ts`、`server/ssh/pty.ts`、`server/engine/runner.ts`、`server/engine/fixer.ts`、`server/engine/planner.ts`、`server/engine/manifest.ts`、`server/config.ts`、`shared/messages.ts`、`assets/tasks.yaml`
- 修复 add-web-ui 验证中 24 个因连接无法建立而失败的场景的根因；不改动 `web/` 任何代码
- 验证依赖：docker compose SSH 测试容器（`docker-compose.test.yml`，add-ssh-foundation 交付）用于真实 SSH 连接场景
