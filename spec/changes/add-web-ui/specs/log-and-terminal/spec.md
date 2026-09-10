# Spec: log-and-terminal

## ADDED Requirements

### Requirement: 执行日志虚拟滚动与跟随

执行日志视图 SHALL 虚拟滚动渲染日志行（内存有界）；SHALL 自动滚动到底部；用户上翻超过阈值 SHALL 暂停跟随并出现"回到底部"入口，回底后恢复自动跟随；每条命令 SHALL 有分隔头（命令文本 + 退出码徽标，成功绿/失败红）。

#### Scenario: 长输出下自动滚底

- **WHEN** 命令持续输出且用户未上翻
- **THEN** 视图自动滚动保持最新行可见

#### Scenario: 上翻暂停跟随与恢复

- **WHEN** 用户上翻查看历史日志后点击回到底部
- **THEN** 恢复自动跟随最新输出

#### Scenario: 命令分隔头与退出码徽标

- **WHEN** 一条命令执行完成
- **THEN** 日志中可见该命令分隔头与退出码徽标（颜色区分成败）

### Requirement: Claude PTY 终端视图

Claude 修复视图 SHALL 渲染 xterm.js 终端：服务端 `claude-output` 分片实时追加渲染（含 ANSI）；用户在终端键盘输入与辅助输入框提交 SHALL 均以 `pty-input` 发送；终端尺寸变化 SHALL 同步（fit）。

#### Scenario: 输出实时渲染

- **WHEN** 修复会话产生输出分片
- **THEN** 终端即时渲染内容与 ANSI 样式

#### Scenario: 双通道输入送达

- **WHEN** 用户在终端键入回车或在辅助输入框提交文本
- **THEN** 两次输入均作为 pty-input 消息发送
