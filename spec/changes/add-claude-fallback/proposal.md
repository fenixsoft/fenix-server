# Proposal: add-claude-fallback

## Why

初始化任务环境差异大（Ubuntu 版本、镜像源状态、已装软件），命令失败不可避免。设计确定的处理方式：失败任务回退到服务器上的 Claude Code，在工具界面内嵌终端中交互式修复，修复后自动重跑并继续队列。这把"人工 SSH 上去排查"变成界面内的一键动作，是本工具区别于纯脚本方案的核心价值。

## What Changes

- 新增 `server/ssh/pty.ts`：基于 ssh2 `shell({ pty })` 的双向 PTY 会话管理（输出流、输入写入、尺寸同步、退出检测）
- 新增 `server/engine/fixer.ts`：修复编排——失败任务触发时构造上下文提示词（失败命令、错误输出尾部、任务描述、claude_hint）、经 PTY 启动 `claude --dangerously-skip-permissions "<prompt>"`（注入隧道代理环境变量保证 API 可达）、claude 进程退出后自动重跑该任务（复用 runner 的 retry 语义）、重跑成功→继续队列 / 仍失败→回到失败态
- 与执行引擎对接：`fixing` 状态接入状态机（failed → fixing → 重试 → success/failed）；`claude-output` 消息流与 `pty-input` 消息路由接通
- 可用性检测：修复前检查服务器上 `claude` 可执行（`which claude`），不可用时报明确错误（提示先执行 Claude Code 安装任务）

## Capabilities

### New Capabilities

- `claude-pty-session`: PTY 会话——ssh2 PTY 双向流封装、claude 进程启动（上下文提示词 + 代理注入）、退出检测、输入写入与尺寸同步
- `fix-workflow`: 修复工作流——失败任务到修复的触发衔接、上下文提示词构造、修复后自动重跑与状态回归、claude 不可用的降级处理

### Modified Capabilities

（无——`fixing` 状态在 add-task-engine 状态机中已预留枚举位，本 SPEC 激活其行为）

## Impact

- 新增文件：`server/ssh/pty.ts`、`server/engine/fixer.ts` 及测试（claude 以 mock 脚本替代）
- 依赖 add-ssh-foundation（SshConnection）、add-task-engine（runner retry 语义与 fixing 状态位）、add-proxy-tunnel（隧道代理注入，claude API 可达性）
- 被 add-builtin-tasks-e2e 的端到端验收依赖
