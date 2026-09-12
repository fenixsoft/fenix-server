# Spec: terminal-log-view

## ADDED Requirements

### Requirement: xterm.js 执行日志渲染

执行日志 Tab SHALL 用 xterm.js 终端渲染执行输出（替代 react-window 纯文本行）；store 的 log 数据流 SHALL 直接写入 xterm 实例，保留 ANSI 转义序列（颜色、光标控制、进度条等）；命令分隔头（命令文本 + 退出码）SHALL 以终端可见形式呈现（如分隔行）。

#### Scenario: 日志含 ANSI 转义渲染

- **WHEN** 任务命令输出含 ANSI 转义序列（颜色/进度条）
- **THEN** xterm 终端按终端语义渲染（颜色正确、进度条可显示），而非显示原始转义字符

#### Scenario: 清屏与滚动

- **WHEN** 新一批日志到达
- **THEN** 终端自动滚动到底部（用户上翻时暂停跟随，与既有 LogViewer 行为一致）

#### Scenario: 命令分隔头可见

- **WHEN** 每个命令开始/结束时
- **THEN** 终端显示命令分隔头（命令文本 + 退出码），区分不同任务的输出

### Requirement: 日志数据源兼容

xterm 化 SHALL 基于既有 log 数据流（store 的 logLines / log 消息），不新增服务端消息类型；Claude 修复终端 SHALL 继续使用既有 xterm 实例，执行日志 SHALL 使用独立 xterm 实例，两者不互窜输出流。

#### Scenario: 两终端隔离

- **WHEN** 执行日志与 Claude 修复同时有输出
- **THEN** 执行日志 Tab 只显示任务执行输出，Claude 终端只显示 Claude 会话输出，互不混流

#### Scenario: 重连后日志恢复

- **WHEN** WebSocket 重连补发快照后
- **THEN** 执行日志 xterm 按快照重建历史输出（或清空重来，不残留断裂状态）