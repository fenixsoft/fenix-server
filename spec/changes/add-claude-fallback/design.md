# Design: add-claude-fallback

## Context

依赖链：连接层（SSH PTY 能力）、任务引擎（retry/fixing 状态）、代理隧道（claude API 可达）。设计文档 §4.2/§8.1 已确定交互：内嵌 xterm 终端、自动注入上下文、claude 退出后自动重跑、用户可在终端回答 claude 提问。设计文档 §13 开放事项 3 已由用户知悉：使用 `--dangerously-skip-permissions` 避免权限确认卡死自动化流程。

## Goals / Non-Goals

**Goals:**

- `PtySession`：`open(cmd)` / `write(data)` / `resize(cols, rows)` / `close()`；数据分片回调、退出回调（退出码）
- `fixer.start(taskId)`：构造提示词 → 可用性检测 → PTY 启动 claude → 输出转发（`claude-output`）→ 退出后自动 `runner.retry(taskId)`；`fixer.abort()`：杀会话回到 failed
- 提示词模板：任务标题/描述 + 失败阶段（command N / verify）+ 失败命令原文 + 错误输出尾部（上限 8KB）+ `claude_hint`（存在时）+ 行为目标（"修复使该命令能成功执行，不要改动其他系统配置"）
- 环境注入：claude 进程带 `HTTP_PROXY/HTTPS_PROXY/http_proxy/https_proxy`（隧道开启时），保证 API 访问；隧道未开启时先按 proxy-injection 语义开隧道
- mock 测试路径：`claude` 用 PATH 上的 mock 脚本替代（输出固定序列 + 读 stdin 回显 + 指定退出码）

**Non-Goals:**

- 前端终端 UI（add-web-ui 已实现 ClaudeTerminal 组件与按钮入口）
- claude 会话的自动审批策略配置、API key 管理（属服务器侧 Claude Code 安装任务）
- 多任务并发修复（同一时刻最多一个修复会话）

## Decisions

1. **claude 启动方式为 PTY 内 `claude --dangerously-skip-permissions "<prompt>"` 一次性会话**：prompt 作为启动参数传入，claude 处理完自动退出，退出即触发重跑；用户仍可在 claude 运行中通过终端介入对话。理由：满足"全自动修复后继续"且保留人工干预通道；不采用 headless `-p`（丢失交互能力）也不采用裸交互模式（需要人工给 prompt）。
2. **错误输出尾部截断 8KB**：claude 上下文有限，apt/npm 长日志全量注入无益；截头留尾（错误通常在尾部）。
3. **修复会话与 runner 的对接点为 runner.retry**：fixer 不复制执行逻辑，claude 退出（正常退出）即调 `runner.retry(taskId)`；`abort`（用户中断/PTY 异常）则把任务置回 failed。理由：状态机单一归属，避免两套重跑路径。
4. **可用性检测在触发时执行**：`which claude && claude --version`，失败返回明确错误（"服务器上 claude 不可用，请先执行 Claude Code 安装任务"），不启动 PTY。

## Risks / Trade-offs

- [`--dangerously-skip-permissions` 允许 claude 无确认执行任意命令] → 用户已知悉接受（设计文档 §13）；提示词中限定目标范围；修复会话仅 root 自用场景（本工具定位）
- [claude 修复改了系统但重跑仍失败] → 回到 failed，用户可再次修复或跳过（状态机已支持，无额外处理）
- [claude 长时间不退出阻塞队列] → 会话无自动超时（修复耗时不可预估）；用户可 abort；界面显示修复进行中状态
- [PTY 输出洪泛（claude 大量输出）] → 直接转发不做缓冲合并（与执行日志同策略），前端 xterm 自身可承受

## Migration Plan

全新模块，无迁移。

## Open Questions

无。
