# Spec: claude-pty-session

## ADDED Requirements

### Requirement: PTY 双向会话

系统 SHALL 提供基于 ssh2 PTY 的双向会话：启动远端命令（shell 命令行字符串）、输出分片实时回调（含 ANSI）、向会话写入输入、终端尺寸同步、会话退出检测（含退出码）；会话 SHALL 可被主动终止。

#### Scenario: 输出回调与退出检测

- **WHEN** 通过 PTY 运行 mock 脚本（输出固定文本后退出，退出码 0）
- **THEN** 输出回调收到该文本，退出回调报告退出码 0

#### Scenario: 输入写入到达会话

- **WHEN** 会话运行中写入一行文本
- **THEN** 远端进程（mock 脚本读 stdin 回显模式）回显该文本

#### Scenario: 主动终止会话

- **WHEN** 会话运行中调用终止
- **THEN** PTY 关闭、退出回调触发，连接可继续复用

### Requirement: claude 进程启动与代理注入

系统 SHALL 以 `claude --dangerously-skip-permissions "<提示词>"` 形式在 PTY 中启动 claude；服务器上 claude 可执行性 SHALL 先经 `which claude` 检测；隧道开启时（或按 proxy-injection 语义开启后）SHALL 注入代理环境变量保证 API 可达；claude 不可用时 SHALL 返回明确错误且不启动会话。

#### Scenario: claude 缺失时明确报错

- **WHEN** 服务器 PATH 上无 claude 时触发修复
- **THEN** 返回"claude 不可用，请先执行 Claude Code 安装任务"类错误，无 PTY 会话建立

#### Scenario: 启动命令含跳过权限参数

- **WHEN** 修复会话启动（mock claude 记录 argv）
- **THEN** 启动参数包含 `--dangerously-skip-permissions` 与提示词
