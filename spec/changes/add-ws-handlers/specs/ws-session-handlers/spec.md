# Spec: ws-session-handlers

## ADDED Requirements

### Requirement: connect 消息建立 SSH 会话

服务端 SHALL 处理 `connect` 消息：以 payload 中的 host/port/username/password 建立 `SshConnection`（已连接时 SHALL 先拒绝并提示已有会话，或按 payload 重新连接）；连接过程与结果 SHALL 以 `connection-status`（connecting/ready/error + 可读 message）回发；认证失败/网络不可达/超时 SHALL 映射为可区分的错误码；连接成功后 SHALL 建立该会话的 runner/fixer/tunnel 上下文并回发任务快照（清单任务全量 pending 状态 + progress）。

#### Scenario: 正确凭据连接成功

- **WHEN** 客户端发送 connect 且目标 SSH 可达、凭据正确
- **THEN** 服务端依次回发 `connection-status` (connecting) 与 `connection-status` (ready)，随后回发任务快照（task-state × N + progress）

#### Scenario: 认证失败错误可区分

- **WHEN** 客户端以错误密码发送 connect
- **THEN** 服务端回发 `connection-status` (error) 且错误码标识认证失败（如 AUTH_FAILED）

#### Scenario: 重复连接被拒绝

- **WHEN** 已有活跃 SSH 会话时再次收到 connect
- **THEN** 服务端回发 error 消息说明已有会话，既有连接不受影响

### Requirement: 任务清单来源与加载

服务端 SHALL 支持两种清单来源：`connect` 消息可携带自定义清单 YAML 文本（服务端以 shared schema 校验，校验失败回 error 并保持未连接态）；未携带时 SHALL 加载服务端内置清单 `assets/tasks.yaml`。加载结果决定 runner 的任务全集，任务状态快照随之下发。

#### Scenario: 携带自定义清单连接

- **WHEN** connect 消息携带合法自定义清单 YAML 文本
- **THEN** 服务端以该清单建立 runner 上下文，快照反映清单任务

#### Scenario: 非法清单被拒绝

- **WHEN** connect 携带不满足 shared schema 的 YAML 文本
- **THEN** 服务端回发 error（含首个校验错误路径），不建立 SSH 连接

#### Scenario: 未携带清单时使用内置清单

- **WHEN** connect 消息不带清单文本
- **THEN** 服务端加载 `assets/tasks.yaml` 并以其任务全集建立快照

### Requirement: exec/stop/retry/skip 驱动任务执行

服务端 SHALL 将 `exec` 物化为 runner 队列并启动执行（队列经依赖闭包校验，含阻塞任务时回 error 不启动）；`stop` SHALL 中止在途命令并复位队列；`retry`/`skip` SHALL 仅在任务处于 failed 且 runner 停留在 awaiting-decision 时有效（否则回 error）。runner 的 `task-state`/`log`/`progress` 事件 SHALL 实时翻译为同名 ServerMessage 回发；`stopped-state`/`queue-finished` 事件 SHALL 翻译为 `task-state`/`progress` 的最终一致状态回发。

#### Scenario: 执行选中任务实时回传

- **WHEN** 客户端发送 exec 携带任务 ID 列表
- **THEN** 客户端按序收到每个任务的 task-state 变化、log 输出分片与 progress 更新，直至 queue-finished 后状态稳定

#### Scenario: 阻塞任务拦截执行

- **WHEN** exec 携带的任务中存在依赖未完成者
- **THEN** 服务端回发 error 说明阻塞任务，不启动执行

#### Scenario: 停止执行

- **WHEN** 执行进行中客户端发送 stop
- **THEN** 在途命令被中止，客户端收到中止后的任务状态与进度复位快照

#### Scenario: 失败后重试

- **WHEN** 任务失败进入待决策态后客户端发送 retry
- **THEN** 该任务重新执行，状态与日志按新一次运行回传

### Requirement: fixWithClaude 与 pty-input 驱动修复会话

服务端 SHALL 将 `fixWithClaude` 委托给 ClaudeFixer.start(taskId)（任务非 failed 时回 error；claude 不可用时回可区分错误且不建会话）；Fixer 的 `claude-output` 事件 SHALL 实时翻译为 `claude-output` ServerMessage 回发；`pty-input` SHALL 写入活跃修复会话 stdin（无活跃会话时回 error）；修复会话结束（正常重跑/中止）后任务状态 SHALL 与 runner 状态机一致回发。

#### Scenario: 触发 Claude 修复并看到输出

- **WHEN** 任务 failed 后客户端发送 fixWithClaude 且服务器上 claude 可用
- **THEN** 客户端收到该任务 task-state (fixing) 与持续的 claude-output 输出流

#### Scenario: 无修复会话时的输入被拒绝

- **WHEN** 无活跃修复会话时客户端发送 pty-input
- **THEN** 服务端回发 error 说明无活跃会话

#### Scenario: claude 不可用报可区分错误

- **WHEN** 服务器未安装 claude 时发送 fixWithClaude
- **THEN** 服务端回发 error 标识 claude 不可用，任务保持 failed

### Requirement: tunnel-open/tunnel-test 驱动反向隧道

服务端 SHALL 将 `tunnel-open` 委托给 TunnelManager.open()（未连接 SSH 时回 error；clientProxy 未配置或不可达时以 `tunnel-status` (open=false + message) 呈现），`tunnel-test` SHALL 执行 testConnectivity() 并以 `tunnel-status` 回发结果（open=true 时含出口 IP 信息，失败含原因）；Tunnel 的 status 事件变化 SHALL 主动翻译为 `tunnel-status` 推送。

#### Scenario: 开启隧道并测试成功

- **WHEN** SSH 已连接且客户端代理可用时发送 tunnel-open，随后发送 tunnel-test
- **THEN** 客户端收到 tunnel-status (open=true, remotePort)，测试后收到含出口 IP 的 tunnel-status

#### Scenario: 未连接时开启被拒绝

- **WHEN** SSH 未连接时发送 tunnel-open
- **THEN** 服务端回发 error 说明需先建立连接

### Requirement: disconnect 清理会话资源

服务端 SHALL 将 `disconnect` 处理为：终止在途执行与修复会话、关闭隧道、关闭 SSH 连接、重置会话上下文，并以 `connection-status` (disconnected) 确认；清理过程 SHALL 幂等（无会话时收到 disconnect 不报错）。

#### Scenario: 断开返回连接视图

- **WHEN** 连接建立后客户端发送 disconnect
- **THEN** 客户端收到 connection-status (disconnected)，再次 connect 可正常建立新会话

#### Scenario: 无会话时断开幂等

- **WHEN** 未建立任何会话时客户端发送 disconnect
- **THEN** 服务端不回发 error，会话状态保持未连接

### Requirement: snapshot 补发全量状态

服务端 SHALL 处理 `snapshot` 消息：按当前会话状态一次性回发全量快照——全部任务的 task-state、progress、隧道 tunnel-status；无活跃会话时 SHALL 回发空快照（progress 0/0 与隧道关闭态）而非 error，以支持前端重连补发语义。

#### Scenario: 重连后快照还原

- **WHEN** 执行进行中客户端 WebSocket 重连成功后发送 snapshot
- **THEN** 客户端收到与中断时刻一致的任务状态、进度与隧道状态

#### Scenario: 无会话快照为空态

- **WHEN** 无活跃会话时客户端发送 snapshot
- **THEN** 服务端回发 progress (0/0) 与 tunnel-status (open=false)，不回发 error

### Requirement: 会话上下文随 WebSocket 断开清理

客户端 WebSocket 连接断开（非显式 disconnect）时，服务端 SHALL 终止在途执行与修复会话并关闭该会话的 SSH 连接与隧道，避免半开 会话泄漏；新连接 SHALL 从干净上下文开始。

#### Scenario: 浏览器关闭后资源释放

- **WHEN** 执行进行中客户端 WebSocket 意外断开
- **THEN** 服务端中止 runner/fixer、关闭隧道与 SSH 连接，后续新 connect 建立全新会话
