# Spec: proxy-injection

## ADDED Requirements

### Requirement: needs_proxy 自动开隧道并注入环境变量

对标记 `needs_proxy: true` 的命令，系统 SHALL 在执行前确保隧道已开启（未开启则自动 open）并以环境变量注入代理：`http_proxy`、`https_proxy`、`HTTP_PROXY`、`HTTPS_PROXY` 均设为 `http://127.0.0.1:<隧道端口>`；命令原文 SHALL 不被修改；对未标记 `needs_proxy` 的命令 SHALL 不注入。

#### Scenario: 注入代理变量执行命令

- **WHEN** 执行 needs_proxy 任务的命令 `env | grep -i proxy`
- **THEN** 输出含四个代理变量且值为隧道地址，且命令行原文不含拼接痕迹

#### Scenario: 未标记任务不注入

- **WHEN** 执行未标记 needs_proxy 的同类命令
- **THEN** 输出不含注入的代理变量

#### Scenario: 隧道未开启时自动建立

- **WHEN** needs_proxy 命令执行时隧道未开启
- **THEN** 隧道被自动开启后命令再执行

### Requirement: 客户端代理不可达的明确报错

隧道 open 时系统 SHALL 先验证客户端代理地址 TCP 可达；不可达时 SHALL 失败并返回"检查客户端代理"类明确错误，SHALL NOT 注册远端监听。

#### Scenario: 代理地址错误时报错可定位

- **WHEN** 以不可达的客户端代理地址开启隧道（或触发 needs_proxy 自动开）
- **THEN** 失败且错误信息指明客户端代理不可达
