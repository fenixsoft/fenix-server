# Spec: reverse-tunnel

## ADDED Requirements

### Requirement: 反向隧道建立与字节流对接

系统 SHALL 支持在已就绪的 SSH 连接上建立反向隧道：在服务器 `127.0.0.1` 注册远程监听端口；服务器侧对该端口的每个 TCP 连接 SHALL 通过 SSH channel 与客户端本地代理地址建立字节流双向对接；任一端关闭 SHALL 关闭对接的另一端。

#### Scenario: 隧道内代理请求全链路可用

- **WHEN** 隧道开启后在服务器执行经隧道端口的 HTTP 代理请求（测试容器内 curl -x 指向隧道端口，客户端侧起本地 mock 代理转发到可达目标）
- **THEN** 请求成功返回，证明服务器→隧道→客户端代理→目标全链路通

#### Scenario: channel 关闭联动清理

- **WHEN** 服务器侧某连接关闭
- **THEN** 对应客户端代理 socket 被关闭，不泄漏

### Requirement: 端口探测策略

隧道端口 SHALL 从 30000 起探测服务器侧空闲端口，SHALL 跳过 20122（预留给服务器 Clash 服务）；探测基于服务器监听端口列表（`ss -tln`）；forwardIn 注册失败 SHALL 兜底换端口重试（上限 5 次）；实际使用端口 SHALL 通过状态事件上报。

#### Scenario: 首个空闲端口被选用

- **WHEN** 服务器 30000 未被监听且开启隧道
- **THEN** 隧道建立在 30000 并上报端口 30000

#### Scenario: 跳过 20122

- **WHEN** 服务器上 20122 无论是否空闲
- **THEN** 隧道端口永不选择 20122

#### Scenario: 端口被占自动顺延

- **WHEN** 服务器 30000 已被占用
- **THEN** 隧道建立在下一个空闲端口

### Requirement: 隧道生命周期

系统 SHALL 提供显式 `open` / `close`；同一时刻 SHALL 最多存在一条隧道（重复 open 返回现有隧道或明确错误）；SSH 连接断开时隧道 SHALL 置为失效并发送状态事件；重连后 SHALL 可重新 open。

#### Scenario: 重复开启不产生双隧道

- **WHEN** 隧道已开启时再次 open
- **THEN** 返回既有隧道（或明确错误），服务器侧仅一个监听端口

#### Scenario: SSH 断开联动失效

- **WHEN** 隧道开启中 SSH 连接断开
- **THEN** 隧道状态变为失效并有状态事件

#### Scenario: 显式关闭释放远端监听

- **WHEN** close 隧道
- **THEN** 服务器侧监听被注销（unforwardIn），后续连接被拒绝
