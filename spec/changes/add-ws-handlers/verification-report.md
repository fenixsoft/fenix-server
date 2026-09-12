# 验证报告：add-ws-handlers

> ⚠️ 本报告由框架于 2026-09-11T03:47:31Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。

## 结论：✅ 通过（verified）

**状态：verified — 31/31 场景通过，0 失败，0 错误（全部场景通过）**

全绿快道: 31/31 场景通过、0 失败 0 警告——无分类对象，跳过 judge 机械 verified

| 指标 | 数量 |
| --- | --- |
| 通过 | 31 |
| 失败 | 0 |
| 错误 | 0 |
| 产品 Bug | 0 |
| 本链增量 Token（输入） | 16.34M |
| 本链增量 Token（输出） | 0.12M |


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| cli-build-typecheck | TypeScript 服务端构建 + web vite 构建 + 类型检查全部通过（dist/server/handlers.js 等产物落盘）。路径出处：package.json scripts(build/typecheck)、tsconfig.server.json、web/vite.config.ts(build.outDir) | pass | 0/5 | - |
| cli-handlers-unit-tests | handlers 单元测试（fake 引擎注入驱动 router.dispatch 断言广播序列，36 用例）+ ws 路由测试（4 用例）全绿。路径出处：server/handlers.test.ts、server/ws.test.ts | pass | 0/2 | - |
| api-health-endpoint | GET /health 返回 200 且响应体含 {"ok": true}——HTTP 面在 ws handler 装配后保持可用（回归点）。路径出处：server/index.ts:84 | pass | 0/2 | - |
| api-root-served | GET / 返回 200 且含页面标题 Fenix Server（web 构建产物静态托管，serving 实例为 ws 装配后产物）。路径出处：server/index.ts:70-81、web/index.html:6 | pass | 0/2 | - |
| api-unknown-route-404 | GET /nonexistent 返回 404 默认路由（回归点）。路径出处：server/index.ts（Fastify 默认 404） | pass | 0/1 | - |
| cli-ssh-test-container-up | 清理并重建 docker SSH 测试容器（fenix-sshd-test，主机端口 2222 root/testpass123），等待密码认证就绪——后续真实 SSH 会话场景的环境前提。路径出处：docker-compose.test.yml、tests/sshd/Dockerfile.sshd、tests/sshd/wait-ssh.ts | pass | 0/2 | - |
| cli-ws-connect-missing-host | connect 缺少 host/username 回 error（connect 消息缺少 host/username）而不建连。路径出处：server/handlers.ts:552-555 | pass | 0/2 | - |
| cli-ws-connect-invalid-manifest | connect 携带不满足 shared schema 的自定义清单 → error MANIFEST_INVALID（含首个校验错误路径 tasks.0.id）且不建立 SSH 连接（无 ready 状态）。路径出处：server/handlers.ts:270-299、:562-564、shared/schema.ts(taskManifestSchema) | pass | 0/3 | - |
| cli-ws-connect-unreachable | connect 到不可达主机（127.0.0.1 未监听端口）→ connection-status error 且 message 含 UNREACHABLE（可区分码，不误报 AUTH）。路径出处：server/handlers.ts:569-585、server/ssh/connection.ts:207-219 | pass | 0/2 | - |
| cli-ws-snapshot-empty-state | 无活跃会话时 snapshot → progress 0/0 + tunnel-status open=false，不回 error（重连补发空态语义）。路径出处：server/handlers.ts:471-475 | pass | 0/3 | - |
| cli-ws-disconnect-idempotent | 无会话时 disconnect → connection-status (disconnected) 且随后不回 error（幂等）。路径出处：server/handlers.ts:817-820、server/handlers.ts:501-531 | pass | 0/2 | - |
| cli-ws-pty-input-no-session | 无会话 pty-input → error NO_SESSION（当前无活跃修复会话）。路径出处：server/handlers.ts:730-739 | pass | 0/2 | - |
| cli-ws-exec-no-session | 无会话 exec → error NO_SESSION（尚未建立 SSH 会话，无法执行任务）。路径出处：server/handlers.ts:597-605 | pass | 0/2 | - |
| cli-ws-tunnel-no-session | 无会话 tunnel-open 与 tunnel-test → error NO_SESSION（尚未建立 SSH 连接）。路径出处：server/handlers.ts:752-758、:782-789 | pass | 0/2 | - |
| web-app-serves-connection-view | 浏览器打开 / 渲染连接视图（Fenix Server 标题、SSH 连接表单、连接按钮），无 console 错误——ws handler 装配后整栈（静态托管 + 前端 SPA）可正常服务。路径出处：server/index.ts:70-81、web/src/App.tsx:84-92、web/src/views/ConnectionView.tsx:186-318 | pass | 0/5 | - |
| cli-ws-connect-success-builtin | 正确凭据 connect（未携带清单 → 内置 assets/tasks.yaml 兜底）→ connection-status connecting→ready，随后快照回发 17 个任务 task-state 全 pending + progress 0/17（含 install-claude-code）。路径出处：server/handlers.ts:539-594、:457-464、:302-311、assets/tasks.yaml | pass | 0/5 | - |
| cli-ws-connect-auth-failed | 错误密码 connect → connection-status (error)，message 含可区分错误码 AUTH_FAILED。路径出处：server/handlers.ts:574-585、server/ssh/connection.ts:207 | pass | 0/2 | - |
| cli-ws-connect-session-exists | 已有活跃 SSH 会话时再次 connect → error SESSION_EXISTS，且原会话不受影响（快照仍回发 3 任务态 + progress 0/3）。路径出处：server/handlers.ts:540-546 | pass | 0/4 | - |
| cli-ws-connect-custom-manifest | connect 携带合法自定义清单 YAML → 快照任务集恰为 echo-ok/echo-fail/slow 且 progress 0/3（服务端 schema 校验后物化 runner）。路径出处：server/handlers.ts:270-299、:457-464 | pass | 0/2 | - |
| cli-ws-exec-success | exec ['echo-ok'] → task-state running → log(stdout 含 integ-ok) → task-state success → progress 1/1（queue-finished 前实时回传）。路径出处：server/handlers.ts:596-642、:394-405、server/engine/runner.ts:341-386 | pass | 0/5 | - |
| cli-ws-exec-blocked-dep | exec 选中任务存在依赖未入队列 → error BLOCKED_TASK（任务 task-b 依赖 task-a 未在本次执行队列中），不启动执行。路径出处：server/handlers.ts:623-635、:898-910 | pass | 0/2 | - |
| cli-ws-exec-fail-skip | exec ['echo-fail'] 失败进入待决策停等 → skip → task-state skipped（仅在 failed + awaiting-decision 时有效）。路径出处：server/handlers.ts:678-696、server/engine/runner.ts:373-377 | pass | 0/3 | - |
| cli-ws-exec-fail-retry | 失败停等后 retry → 该任务重新执行（running）→ 退出码 3 再次失败（failed）——按新一次运行回传。路径出处：server/handlers.ts:657-676、server/engine/runner.ts:363-370 | pass | 0/3 | - |
| cli-ws-stop-execution | exec ['slow'](sleep 30) 运行中发送 stop → 在途命令中止，stopped-state 重放逐任务 task-state + progress(0/1) 复位。路径出处：server/handlers.ts:644-655、:406-416、server/engine/runner.ts:308-315 | pass | 0/2 | - |
| cli-ws-fix-claude-unavailable | failed 任务 fixWithClaude（测试容器未安装 claude）→ error CLAUDE_UNAVAILABLE（服务器上 claude 不可用），任务保持 failed 不置 fixing、不建会话。路径出处：server/handlers.ts:699-727、server/engine/fixer.ts:192-209 | pass | 0/3 | - |
| cli-ws-pty-input-no-fixer | 已连接但无活跃修复会话时 pty-input → error NO_SESSION（当前无活跃修复会话）。路径出处：server/handlers.ts:730-739 | pass | 0/2 | - |
| cli-ws-tunnel-no-proxy-address | connect 未配置 clientProxy（tunnel 为 null）→ tunnel-open/tunnel-test 均回 error（未配置客户端代理）。路径出处：server/handlers.ts:761-767、:791-794、:376-378 | pass | 0/2 | - |
| cli-ws-tunnel-unreachable-proxy | connect 携带不可达 clientProxy → tunnel-open 终态 tunnel-status open=false 且 message 含代理原因；tunnel-test → tunnel-status open=false 且 message 含连通性测试失败（结果经 tunnel-status 回传）。路径出处：server/handlers.ts:752-779、:781-814、server/ssh/tunnel.ts:211-222、:181-200 | pass | 0/3 | - |
| cli-ws-snapshot-consistent-state | exec 完成后发送 snapshot → 回发与运行态一致的全量状态（echo-ok:success、其余 pending、progress 1/1、隧道关闭态 open=false）。路径出处：server/handlers.ts:467-493 | pass | 0/3 | - |
| cli-ws-disconnect-reconnect | connect 建立会话后 disconnect → connection-status (disconnected)；同一 socket 再 connect → 新会话 ready（断开后会话资源可复用）。路径出处：server/handlers.ts:817-820、:539-594 | pass | 0/2 | - |
| cli-ws-ws-close-cleanup | ws1 建连后 ws2 connect → SESSION_EXISTS；ws1 异常关闭（非显式 disconnect）后服务器清理会话上下文，ws2 可建立全新会话——避免半开会话泄漏。路径出处：server/handlers.ts:241-254、:497-531 | pass | 0/3 | - |

## 本轮场景集变更

当前稳定场景集共 31 个（第 1 轮）。

- 首轮写入 31 个场景

