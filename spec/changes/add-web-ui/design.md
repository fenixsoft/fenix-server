# Design: add-web-ui

## Context

后端能力与消息契约已由前序 SPEC 确定（`shared/messages.ts` 判别联合）。本 SPEC 是纯前端实现：Vite 构建、产物由 server 静态托管（开发期 vite dev server 代理 `/ws` 到后端）。UI 结构遵循设计文档 §8（双视图 + ASCII 布局图）。

## Goals / Non-Goals

**Goals:**

- Vite + React 18 + AntD 5 + Zustand + xterm.js 工程与构建链（`npm run build` 产出至 `server` 托管目录）
- `wsClient`：单例 WebSocket 封装（连接、自动重连退避、消息入 store、发送类型安全）
- store：`connectionSlice` / `tasksSlice`（清单、勾选集、状态、进度）/ `logSlice`（环形缓冲上限 5000 条）/ `tunnelSlice`；重连成功后发 `snapshot` 请求补发全量
- 连接视图：AntD Form 校验、服务器下拉（config 列表）+ 新增、密码"记住"开关带警示文案
- 任务树：AntD Tree 或自绘分组列表；状态图标映射（░⟳✓✗⚡»）；勾选级联调 planner 语义（前端仅呈现，级联结果由本地计算与后端一致规则实现）；阻塞置灰
- 日志视图：`react-window` 虚拟滚动 + 自动滚底（scroll 位置离底 > 40px 时暂停跟随，回底恢复）；命令分隔行
- Claude 终端：xterm.js + fit addon；`claude-output` 追加渲染；输入框与终端键盘事件均发 `pty-input`
- 隧道指示器：Tag 颜色（已连通绿/关闭灰/错误红）+ 端口 + 「测试」按钮（结果 Popover 显示出口 IP）

**Non-Goals:**

- Claude 修复的后端编排（add-claude-fallback）
- 多主题/移动端适配（桌面浏览器优先）
- 服务端渲染、i18n（中文界面硬编码）

## Decisions

1. **Zustand 而非 Redux Toolkit**：状态量小、无中间件需求，boilerplate 最少（设计文档 §8.3 已定）。
2. **日志用受控环形缓冲 + react-window**：上限 5000 条丢弃最旧，避免长任务内存膨胀；按行渲染（一个分片可能多行，入 store 时按 `\n` 切行归并同流标记）。
3. **级联勾选/阻塞判定在前端本地复算**：规则与 planner 一致（传递依赖闭包、依赖完成态检查），清单与状态都在 store 中，无需每次往返后端；执行仍以后端 planner 结果为准。
4. **xterm.js 仅用于 Claude PTY；执行日志不用终端组件**：日志需要 AntD 风格的分隔头/徽标/颜色标记，虚拟列表更可控；终端体验（光标、退格、ANSI）只有 PTY 需要。
5. **构建产物路径**：`web/vite.config.ts` `build.outDir` 指向 server 静态托管目录（`server/public`），`server` 端 `@fastify/static` 指向同一路径。

## Risks / Trade-offs

- [WebSocket 未连接时 UI 可操作性混乱] → 全局连接状态门控：未连接强制显示连接视图；执行按钮在断线时禁用
- [xterm 输入焦点与页面快捷键冲突] → 终端容器获焦时才拦截键盘；提供明确的"点击终端获得输入焦点"提示
- [AntD 5 与 React 18 并发特性兼容] → 使用 AntD 5 稳定组件子集（Form/Tree/Table/Tag/Progress/Tabs/Modal），不用实验性 API

## Migration Plan

全新模块，无迁移。

## Open Questions

无。
