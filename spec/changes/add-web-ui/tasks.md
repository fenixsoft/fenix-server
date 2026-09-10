# Tasks: add-web-ui

## Deliverables

```yaml
- path: web/package.json
  kind: new
- path: web/vite.config.ts
  kind: new
- path: web/tsconfig.json
  kind: new
- path: web/index.html
  kind: new
- path: web/src/main.tsx
  kind: new
- path: web/src/App.tsx
  kind: new
- path: web/src/wsClient.ts
  kind: new
- path: web/src/stores/appStore.ts
  kind: new
- path: web/src/views/ConnectionView.tsx
  kind: new
- path: web/src/views/TaskView.tsx
  kind: new
- path: web/src/components/TaskTree.tsx
  kind: new
- path: web/src/components/ExecutionToolbar.tsx
  kind: new
- path: web/src/components/LogViewer.tsx
  kind: new
- path: web/src/components/ClaudeTerminal.tsx
  kind: new
- path: web/src/components/TaskDetailPanel.tsx
  kind: new
- path: web/src/components/TunnelIndicator.tsx
  kind: new
- path: web/src/stores/appStore.test.ts
  kind: new
- path: web/src/components/TaskTree.test.tsx
  kind: new
- path: web/src/components/LogViewer.test.tsx
  kind: new
```

## 1. 工程与状态基础

- [x] 1.1 搭建 Vite + React 18 + AntD 5 + TypeScript 工程（outDir 指向 server/public、dev 代理 /ws），安装 zustand/xterm.js/react-window
- [x] 1.2 编写 `wsClient.ts`：类型安全消息收发、退避自动重连、重连后快照请求
- [x] 1.3 编写 `stores/appStore.ts`：connection/tasks/log（环形缓冲 5000 行）/tunnel 四切片与消息入 store 处理，配套 `appStore.test.ts`

## 2. 连接视图

- [x] 2.1 编写 `ConnectionView.tsx`：服务器下拉/新增表单（校验、记住密码风险提示）、客户端代理地址、清单选择、连接动作与可区分错误呈现

## 3. 任务看板

- [x] 3.1 编写 `TaskTree.tsx`：分组折叠、六态状态图标、级联勾选、阻塞置灰，配套 `TaskTree.test.tsx`
- [x] 3.2 编写 `ExecutionToolbar.tsx`：全选/清空/执行选中/停止 + 进度条；`TaskDetailPanel.tsx`：任务详情
- [x] 3.3 失败任务三动作（重试/交给 Claude 修复/跳过）消息发送与状态联动

## 4. 日志与终端

- [x] 4.1 编写 `LogViewer.tsx`：虚拟滚动、自动滚底/上翻暂停/回底恢复、命令分隔头与退出码徽标，配套 `LogViewer.test.tsx`
- [x] 4.2 编写 `ClaudeTerminal.tsx`：xterm.js 渲染 claude-output（ANSI）、键盘与辅助输入框双通道 pty-input、fit 尺寸同步

## 5. 应用壳

- [x] 5.1 编写 `App.tsx`：视图路由（未连接连视图/已连任务视图）、顶栏、状态栏、三 Tab 主区
- [x] 5.2 编写 `TunnelIndicator.tsx`：三色状态 + 端口 + 测试气泡
- [ ] 5.3 构建产物接入 server 静态托管，浏览器端到端手工冒烟（连接测试容器→执行样例任务→观察日志/进度）
