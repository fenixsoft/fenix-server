# Spec: tunnel-diagnostics

## ADDED Requirements

### Requirement: 隧道状态事件

系统 SHALL 发射隧道状态变更事件（closed/opening/open/error，含实际端口与错误信息）；事件 SHALL 可被 ws 层订阅转译为 `tunnel-status` 消息。

#### Scenario: 状态变更可见

- **WHEN** 隧道从 closed 到 open 再到 close
- **THEN** 每次变更均发射对应状态事件且携带端口

### Requirement: 连通性测试

系统 SHALL 提供连通性测试：在服务器执行经隧道的 `curl -x http://127.0.0.1:<P> https://api.ipify.org`（超时 10 秒），成功 SHALL 返回出口 IP；隧道未开启/链路故障 SHALL 返回失败原因而非挂起。

#### Scenario: 链路正常返回出口 IP

- **WHEN** 隧道开启且客户端代理可用时执行测试
- **THEN** 返回出口 IP 文本

#### Scenario: 隧道未开启测试失败不挂起

- **WHEN** 隧道未开启时执行测试
- **THEN** 快速返回失败原因（10 秒内）
