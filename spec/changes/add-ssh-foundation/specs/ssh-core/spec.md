# Spec: ssh-core

## ADDED Requirements

### Requirement: 密码认证连接管理

系统 SHALL 基于 ssh2 提供到 Linux 服务器的 SSH 连接，支持用户名 + 密码认证；连接 SHALL 暴露状态（`connecting` / `ready` / `closed` / `error`）与状态变更事件；认证失败、网络不可达、连接超时 SHALL 产生可区分的错误（错误类别字段）；连接 SHALL 启用 keepalive（间隔 30 秒）并在连续无响应时判定断开、触发 `closed` 事件。

#### Scenario: 密码认证成功

- **WHEN** 以正确的用户名密码连接测试容器（openssh-server）
- **THEN** 连接进入 `ready` 状态

#### Scenario: 认证失败可区分

- **WHEN** 以错误密码连接
- **THEN** 连接进入 `error` 状态，错误类别标识为认证失败（区别于网络不可达与超时）

#### Scenario: 服务器不可达可区分

- **WHEN** 连接一个不存在的地址（连接被拒绝或超时）
- **THEN** 连接进入 `error` 状态，错误类别标识为网络不可达或超时

#### Scenario: 服务器主动断连触发事件

- **WHEN** 连接 ready 后测试容器终止 SSH 会话
- **THEN** 连接触发 `closed` 事件并进入 `closed` 状态

### Requirement: 命令执行与流式输出

连接 SHALL 支持执行单条 shell 命令：实时回调输出分片（stdout 与 stderr 分流标记）、命令结束后返回退出码；多个命令 SHALL 可在同一连接上顺序执行（channel 复用）。

#### Scenario: 执行成功命令返回退出码 0

- **WHEN** 在测试容器执行 `echo hello`
- **THEN** 回调收到 stdout 分片包含 `hello`，最终退出码为 0

#### Scenario: stderr 分流标记

- **WHEN** 执行 `echo err >&2`
- **THEN** 收到的输出分片标记为 stderr 且内容包含 `err`

#### Scenario: 非零退出码上报

- **WHEN** 执行 `exit 3`
- **THEN** 命令结束返回退出码 3

#### Scenario: 顺序执行多条命令

- **WHEN** 在同一连接上依次执行两条命令
- **THEN** 两条命令各自正确返回，互不干扰

### Requirement: SFTP 文件与目录上传

连接 SHALL 支持通过 SFTP 上传单个文件（fastPut 语义）与递归上传目录（自动创建远端多级目录，保持相对路径结构）；远端目标目录不存在时 SHALL 自动创建。

#### Scenario: 上传单文件

- **WHEN** 上传本地文件到远端 `/root/upload-test/a.txt`
- **THEN** 远端文件存在且内容一致（`/root/upload-test` 自动创建）

#### Scenario: 递归上传目录

- **WHEN** 上传含多级子目录的本地目录到远端
- **THEN** 远端目录结构与其中的文件内容与本地一致

### Requirement: 连接关闭资源清理

调用关闭 SHALL 释放全部活跃 channel 与 SFTP 会话并断开 TCP；关闭后调用执行/上传 SHALL 返回明确错误而非挂起。

#### Scenario: 关闭后操作报错

- **WHEN** 连接关闭后尝试执行命令
- **THEN** 立即返回"连接已关闭"类错误，不挂起
