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

- [x] 1.1 `shared/messages.ts` 新增 ServerMessage 成员：`{ type: 'manifest'; payload: { manifest: TaskManifest } }`（复用 shared/schema.ts 类型），并更新前端 `isServerMessage` 守卫以识别新类型
- [x] 1.2 `server/handlers.ts` `sendManifestSnapshot()` 在 task-state 快照之前先广播 `manifest` 消息（携带当前会话 manifest）；snapshot 补发路径同样先 manifest
- [x] 1.3 `server/handlers.test.ts` 补充断言：connect 成功后消息序列为 connection-status(ready) → manifest → task-state × N → progress

## 2. 前端清单覆盖与错误可见化

- [x] 2.1 `web/src/stores/appStore.ts` `applyServerMessage` 新增 `case 'manifest'`：用 payload.manifest 覆盖本地 manifest、按新任务集重建 taskStates（全 pending）、清空勾选/进度/日志，保持 sshStatus 不变
- [x] 2.2 `web/src/stores/appStore.test.ts` 补充 manifest 覆盖分支测试（内置 10 任务 → 服务端 17 任务覆盖后任务树/置灰/勾选状态重建正确）
- [x] 2.3 `web/src/views/TaskView.tsx` 顶部新增全局错误提示（渲染 lastError 的 Alert），展示 `error` 消息（未知任务 id/BLOCKED_TASK/NO_SESSION）；store 的成功动作发起处（connect/exec/stop 等）清除 lastError

## 3. e2e 执行链路测试

- [x] 3.1 新建 `tests/e2e/fixtures/exec-flow-tasks.yaml`：含 `echo-ok`（无依赖，`echo hello-from-exec`，verify `true`）与 `fail-always`（`exit 1`）两个任务
- [x] 3.2 新建 `tests/e2e/exec-flow.test.ts`：buildServer 起真实 handlers，WS 客户端 connect 自定义 YAML 清单 → 断言先收 manifest（任务 id 与 fixture 一致）→ exec `[echo-ok]` → 断言 task-state pending→running→success + log 含 `hello-from-exec` + progress 递增
- [x] 3.3 `exec-flow.test.ts` 失败决策态：exec `[fail-always]` → 断言 task-state failed + runner 停 awaiting-decision → 发 retry → 状态离开 failed 重进 running；发 skip → 状态 skipped
- [x] 3.4 e2e 前置：确认 `fenix-sshd-test` 容器（宿主 2222 root/testpass123）在跑，测试内 connect 用该目标；容器缺则用 `docker-compose.test.yml` 起

## 4. 回归验证

- [x] 4.1 server 全量测试（handlers 单测含 manifest 序列）+ web 全量测试（appStore 覆盖分支）+ `npm run build` 通过
- [x] 4.2 浏览器冒烟：真实服务 connect 后任务树显示 17 任务、置灰正确、错误提示可见；勾选无依赖任务执行成功

## 验证修复（原地打回第 1 轮）

### 上轮实现结论（自动携带，来自上一轮 implementer 收工结论）

交付 manifest 下发协议与前端执行链路修复：1) shared/messages.ts 新增 ManifestPayload + manifest ServerMessage，isServerMessage 结构化守卫自动识别；2) handlers.ts sendManifestSnapshot/sendFullSnapshot 严格先 manifest 后 task-state（design 决策 2 顺序保证）；3) appStore applyServerMessage case manifest 整体覆盖 BUILTIN_MANIFEST、重建 taskStates 为全 pending、清空勾选/进度/日志（不重置 sshStatus）；4) TaskView 顶部 lastError Alert 全局可见化（纯展示，生命周期由 connect/exec/stop 成功动作清除）；5) exec-flow e2e 覆盖：manifest 一致性（17 任务 = assets/tasks.yaml）+ echo-ok 成功链路 + echo-dep 依赖闭包串行 + fail-always 重试/跳过决策态。全量回归 24 文件 231 测试通过，server tsc + web tsc + vite build 零错误，浏览器冒烟验证：connect → manifest(17 任务) → task-state 全 pending → 任务树渲染正确（无依赖可选、有依赖置灰）。

- [ ] 先复核失败有效性：逐条核对 `spec/changes/add-manifest-delivery/verification-report.md` 中失败场景的期望断言（状态字面量/选择器/前置数据）与产品实际行为是否相符——断言与产品不符属场景缺陷，修场景文件；确属产品行为不符才修产品代码
- [ ] 按复核结论修复：场景缺陷改场景文件，真实产品 Bug 改产品代码
- [ ] 修复后重跑验证确认通过
