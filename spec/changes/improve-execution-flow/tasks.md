## Deliverables

```yaml
- path: server/engine/runner.ts
  kind: modify
- path: server/engine/runner.test.ts
  kind: modify
- path: server/handlers.ts
  kind: modify
- path: server/handlers.test.ts
  kind: modify
- path: web/src/stores/appStore.ts
  kind: modify
- path: web/src/stores/appStore.test.ts
  kind: modify
- path: web/src/components/ExecutionSteps.tsx
  kind: new
- path: web/src/components/ExecutionToolbar.tsx
  kind: modify
- path: web/src/components/LogViewer.tsx
  kind: modify
- path: web/src/views/TaskView.tsx
  kind: modify
- path: tests/e2e/exec-flow.test.ts
  kind: modify
```

## 1. 依赖重跑语义修复

- [x] 1.1 `server/engine/runner.ts` `run(taskIds, opts?)` 不再无条件把全 manifest 重置 pending：仅重置本次队列内任务，未执行任务保留历史状态；`opts.reset` 显式开启时才全重置（供「全部重跑」）
- [x] 1.2 `server/handlers.ts` `handleExec` 过滤 `status==='success'` 的 taskIds（兜底，除非 payload 带 `rerun:true`）；`exec` payload 支持 `rerun: boolean` 标记
- [x] 1.3 `runner.test.ts` + `handlers.test.ts` 补断言：执行子集不抹历史状态；success 前置不入队；rerun 时全重置
- [x] 1.4 `web/src/stores/appStore.ts` `cascade` 仅加入 `status !== 'success'` 的依赖；`exec` 不再把全部任务置 pending（仅本次队列），并携带 `rerun` 标志
- [x] 1.5 `appStore.test.ts` 补依赖过滤回归：勾选下游任务时 success 依赖不进选中集

## 2. Step 步骤导航

- [x] 2.1 新建 `web/src/components/ExecutionSteps.tsx`：按 `topoSort` 顺序渲染 antd Steps，Step 状态由 taskStates 驱动（success→finish / running→process / 其余→wait），tooltip 标注 group
- [x] 2.2 `web/src/views/TaskView.tsx` 顶部嵌入 ExecutionSteps（错误条之下、左树+右 Tab 之上），左侧任务树保留原样

## 3. 执行全部与全部重跑

- [x] 3.1 `web/src/stores/appStore.ts` 新增 `execAll` action：target = 全任务 id 经「过滤 success」+「cascade 闭包」后 exec（自动携带 rerun 标志按开关）
- [x] 3.2 `ExecutionToolbar.tsx` 新增「执行全部」按钮（执行中禁用）与「全部重跑」Switch；「执行选中」沿用过滤后语义
- [x] 3.3 `appStore.test.ts` 补 execAll 与 rerun 开关分支测试

## 4. xterm.js 执行日志

- [x] 4.1 `web/src/components/LogViewer.tsx` 重写为 xterm 实例渲染（复用 `@xterm/xterm` + fit addon），log 数据流 `term.write` 保留 ANSI；命令头写为分隔行
- [x] 4.2 环形缓冲沿用 5000 行上限：超出时整屏清空重写最近 N 行（避免 xterm 历史膨胀）；上翻暂停自动滚底沿用既有交互
- [x] 4.3 `appStore.test.ts` / 组件测试确认两终端隔离（执行日志 xterm 与 ClaudeTerminal 独立）

## 5. 回归验证

- [x] 5.1 更新 `tests/e2e/exec-flow.test.ts`：新增「先执行 A success，再执行依赖 A 的 B，断言 A 不重跑、B 成功」场景；既有单次 exec 全重置断言改为保留历史状态
- [x] 5.2 server + web 全量测试通过，`npm run build`（server tsc + web vite）零错误
- [x] 5.3 浏览器冒烟：连接后 Step 导航条展示 17 步；执行全部跑通（可选入口任务成功）；开启全部重跑后 success 任务重跑；日志 xterm 显示 ANSI