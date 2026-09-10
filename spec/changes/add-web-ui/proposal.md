# Proposal: add-web-ui

## Why

工具的交互面：用户在浏览器中完成连接配置、任务勾选、执行控制、进度与日志观察、Claude 修复交互。add-ssh-foundation/add-task-engine/add-proxy-tunnel 提供了后端能力与 WebSocket 消息契约，本 SPEC 实现完整前端（React 18 + Ant Design 5 + Vite + Zustand + xterm.js），让工具可被实际操作。

## What Changes

- 新建 `web/` Vite 工程：React 18 + Ant Design 5 + TypeScript，构建产物输出至 server 托管目录
- WebSocket 客户端与 Zustand 全局状态：连接状态、任务与勾选集、日志环形缓冲、隧道状态、进度；断线自动重连与快照补发
- 连接视图：服务器选择/新增表单（名称/主机/端口/用户名/密码/记住密码）、客户端代理地址、任务清单选择、连接按钮
- 任务执行视图：按 group 分组的任务树（复选框、状态图标、依赖级联勾选与阻塞置灰）、执行工具条（全选/清空/执行选中/停止 + 进度条）、失败动作（重试/交给 Claude 修复/跳过）、任务详情面板
- 执行日志视图：虚拟滚动、自动滚底（上翻暂停跟随）、命令分隔头（命令文本 + 退出码徽标）
- Claude 修复视图：xterm.js 终端（PTY 双向：输出渲染 + 用户输入发送）、修复会话与任务状态联动展示
- 隧道指示器：状态 + 端口 + 测试按钮（出口 IP 回显）
- 应用壳：顶栏（连接信息/断开）、状态栏（SSH/隧道/当前任务/耗时）、Tab 布局

## Capabilities

### New Capabilities

- `connection-view`: 连接视图——服务器配置管理表单、凭据输入与记住密码（含风险提示）、连接动作与错误呈现
- `task-board`: 任务看板——分组任务树、级联勾选与阻塞置灰、执行控制（执行/停止/重试/跳过/交给 Claude）、进度与任务详情
- `log-and-terminal`: 日志与终端——虚拟滚动执行日志（自动滚底/暂停跟随、命令分隔头）与 xterm.js PTY 终端组件（双向）
- `app-shell`: 应用壳与状态管理——WebSocket 客户端、Zustand store、断线重连与快照补发、顶栏/状态栏/Tab 布局、隧道指示器

### Modified Capabilities

（无）

## Impact

- 新增文件：`web/` 全部前端源码与配置
- 依赖 add-ssh-foundation 的 `shared/messages.ts`（消息类型）与 ws 路由
- 依赖 add-task-engine（task-state/log/progress 语义）、add-proxy-tunnel（tunnel-status）
- Claude 修复的完整工作流（fixWithClaude 的后端行为）由 add-claude-fallback 提供；本 SPEC 实现其前端入口按钮与终端展示，后端未就绪时按钮报"能力未就绪"
