# Spec: e2e-verification

## ADDED Requirements

### Requirement: ubuntu 24.04 容器验证环境

端到端验证 SHALL 以 `ubuntu:24.04` 镜像构建容器执行：集成级镜像（`Dockerfile.sshd`：安装 openssh-server，root 密码登录，前台 sshd）与 E2E 级镜像（`Dockerfile.systemd`：systemd 为 PID1 特权容器，内装 openssh-server 并 systemctl 启用 ssh）；E2E 容器 SHALL 暴露映射的 SSH 端口供工具连接。

#### Scenario: E2E 容器可被工具以密码连接

- **WHEN** 启动 E2E 容器并以 root/注入密码连接
- **THEN** 连接 ready 且 `cat /etc/os-release` 显示 24.04

#### Scenario: systemd 服务可在 E2E 容器内管理

- **WHEN** 在 E2E 容器内执行 `systemctl is-active ssh`
- **THEN** 返回 active（证明 systemctl 类任务可真实执行）

### Requirement: 全量清单实际初始化执行与断言

E2E SHALL 通过工具（引擎层直连）对 E2E 容器执行内置清单全量任务（单队列串行），并逐任务断言成功；`verify` 全部通过；执行产物抽查（`.zshrc` 就位、authorized_keys 含公钥、sshd 配置生效、apt 源指向阿里云）SHALL 断言；任一失败 SHALL 收集失败任务日志与容器状态快照到 `tests/e2e/out/`。

#### Scenario: 全量任务执行成功

- **WHEN** 对新起的 E2E 容器执行内置全量清单（代理桩模式，mock claude）
- **THEN** 全部任务 success、verify 通过、产物抽查通过

#### Scenario: 失败时留存排查快照

- **WHEN** E2E 中某任务失败
- **THEN** `tests/e2e/out/` 含该任务完整日志与容器内状态快照文件

### Requirement: 代理桩链路验证

E2E SHALL 内置本地代理桩（HTTP 代理转发器并记录请求）：needs_proxy 任务执行时"客户端代理"指向桩；断言这些任务的出网请求出现在桩记录中（证明真实经过隧道），不以海外真实可达为自动化断言；提供 `E2E_PROXY` 环境变量可切换为真实代理执行完整出网验证。

#### Scenario: needs_proxy 请求经隧道抵达代理桩

- **WHEN** E2E 执行 needs_proxy 任务（代理桩模式）
- **THEN** 桩记录中出现该任务产生的出网请求

#### Scenario: 真实代理模式可选

- **WHEN** 设置 E2E_PROXY 为真实代理地址执行 E2E
- **THEN** 隧道指向真实代理且海外任务真实出网（手动/夜间验证路径）

### Requirement: 手动验收清单

`docs/acceptance.md` SHALL 提供真实 Ubuntu 服务器的手动验收步骤：环境要求、全流程执行、Claude 修复路径演练（真实 claude）、已知限制（订阅配置缺失时跳过 install-clash 的说明）。

#### Scenario: 验收文档可独立执行

- **WHEN** 按文档步骤在真实服务器操作
- **THEN** 无需额外口头说明即可完成验收
