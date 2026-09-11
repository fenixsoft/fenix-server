## Deliverables

```yaml
- path: shared/messages.ts
  kind: modify
- path: server/handlers.ts
  kind: modify
- path: server/handlers.test.ts
  kind: modify
- path: web/src/stores/appStore.ts
  kind: modify
- path: web/src/stores/appStore.test.ts
  kind: modify
- path: web/src/views/TaskView.tsx
  kind: modify
- path: tests/e2e/fixtures/exec-flow-tasks.yaml
  kind: new
- path: tests/e2e/exec-flow.test.ts
  kind: new
```

## 1. 协议与服务端 manifest 下发

- [ ] 1.1 `shared/messages.ts` 新增 ServerMessage 成员：`{ type: 'manifest'; payload: { manifest: TaskManifest } }`（复用 shared/schema.ts 类型），并更新前端 `isServerMessage` 守卫以识别新类型
- [ ] 1.2 `server/handlers.ts` `sendManifestSnapshot()` 在 task-state 快照之前先广播 `manifest` 消息（携带当前会话 manifest）；snapshot 补发路径同样先 manifest
- [ ] 1.3 `server/handlers.test.ts` 补充断言：connect 成功后消息序列为 connection-status(ready) → manifest → task-state × N → progress

## 2. 前端清单覆盖与错误可见化

- [ ] 2.1 `web/src/stores/appStore.ts` `applyServerMessage` 新增 `case 'manifest'`：用 payload.manifest 覆盖本地 manifest、按新任务集重建 taskStates（全 pending）、清空勾选/进度/日志，保持 sshStatus 不变
- [ ] 2.2 `web/src/stores/appStore.test.ts` 补充 manifest 覆盖分支测试（内置 10 任务 → 服务端 17 任务覆盖后任务树/置灰/勾选状态重建正确）
- [ ] 2.3 `web/src/views/TaskView.tsx` 顶部新增全局错误提示（渲染 lastError 的 Alert），展示 `error` 消息（未知任务 id/BLOCKED_TASK/NO_SESSION）；store 的成功动作发起处（connect/exec/stop 等）清除 lastError

## 3. e2e 执行链路测试

- [ ] 3.1 新建 `tests/e2e/fixtures/exec-flow-tasks.yaml`：含 `echo-ok`（无依赖，`echo hello-from-exec`，verify `true`）与 `fail-always`（`exit 1`）两个任务
- [ ] 3.2 新建 `tests/e2e/exec-flow.test.ts`：buildServer 起真实 handlers，WS 客户端 connect 自定义 YAML 清单 → 断言先收 manifest（任务 id 与 fixture 一致）→ exec `[echo-ok]` → 断言 task-state pending→running→success + log 含 `hello-from-exec` + progress 递增
- [ ] 3.3 `exec-flow.test.ts` 失败决策态：exec `[fail-always]` → 断言 task-state failed + runner 停 awaiting-decision → 发 retry → 状态离开 failed 重进 running；发 skip → 状态 skipped
- [ ] 3.4 e2e 前置：确认 `fenix-sshd-test` 容器（宿主 2222 root/testpass123）在跑，测试内 connect 用该目标；容器缺则用 `docker-compose.test.yml` 起

## 4. 回归验证

- [ ] 4.1 server 全量测试（handlers 单测含 manifest 序列）+ web 全量测试（appStore 覆盖分支）+ `npm run build` 通过
- [ ] 4.2 浏览器冒烟：真实服务 connect 后任务树显示 17 任务、置灰正确、错误提示可见；勾选无依赖任务执行成功