# Spec: service-foundation

## ADDED Requirements

### Requirement: 本地服务启动与监听边界

系统 SHALL 提供 Node.js 进程入口（`server/index.ts` 编译产物），启动 Fastify HTTP 服务并仅监听 `127.0.0.1` 的可配置端口（默认端口 SHALL 存在且不使用 20122）；服务启动成功后 SHALL 在日志中输出实际监听地址。

#### Scenario: 默认启动

- **WHEN** 以默认配置启动服务进程
- **THEN** 服务在 `127.0.0.1:<默认端口>` 监听，HTTP GET 健康路径返回 200

#### Scenario: 拒绝非回环监听

- **WHEN** 配置尝试绑定非 `127.0.0.1` 地址
- **THEN** 服务启动失败并输出明确错误（安全边界不允许对外暴露）

### Requirement: 静态托管前端构建产物

系统 SHALL 托管指定目录下的静态文件（前端构建产物）；目录不存在或为空时服务 SHALL 正常启动并返回占位响应，不抛错。

#### Scenario: 托管存在的静态文件

- **WHEN** 静态目录中存在 `index.html` 且用户 GET 根路径
- **THEN** 返回该文件内容

#### Scenario: 静态目录缺失不阻塞启动

- **WHEN** 静态目录不存在时启动服务
- **THEN** 服务正常启动，GET 根路径返回占位内容

### Requirement: WebSocket 消息通道与路由

系统 SHALL 在 `/ws` 提供 WebSocket 端点；客户端消息为 `{ type, payload }` JSON；服务端 SHALL 按 `type` 分发到已注册 handler，并向客户端推送 `ServerMessage`；收到未知 `type` 时 SHALL 回复错误消息且不断开连接；无效 JSON SHALL 不导致进程崩溃。

#### Scenario: 消息按类型分发

- **WHEN** 客户端发送已注册类型的消息
- **THEN** 对应 handler 被调用，其返回/推送的消息到达客户端

#### Scenario: 未知消息类型容错

- **WHEN** 客户端发送未注册的 `type`
- **THEN** 服务端回复包含错误信息的 `error` 消息，连接保持

#### Scenario: 非法输入不崩溃

- **WHEN** 客户端发送非 JSON 文本
- **THEN** 服务进程不崩溃，连接可继续使用或被安全关闭

### Requirement: 本地配置读写

系统 SHALL 提供本地 `config.json` 的加载与保存：服务器列表（名称、主机、端口、用户名、是否记住密码及可选密码字段）、客户端代理地址、最近任务清单路径；文件不存在时 SHALL 返回默认空配置；保存 SHALL 原子写入（临时文件 + rename）。

#### Scenario: 首次加载无配置文件

- **WHEN** `config.json` 不存在时加载配置
- **THEN** 返回结构完整的默认空配置（空服务器列表等）

#### Scenario: 保存后可读回

- **WHEN** 保存含一台服务器的配置后再加载
- **THEN** 读回内容与保存内容一致

### Requirement: 进程级健康与优雅退出

服务 SHALL 在 SIGINT/SIGTERM 时关闭 HTTP 服务与活跃 SSH 连接后退出；进程内未捕获异常 SHALL 记录日志且不静默退出。

#### Scenario: SIGTERM 优雅退出

- **WHEN** 服务运行中收到 SIGTERM
- **THEN** 活跃连接被关闭，进程以 0 退出
