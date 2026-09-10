# Tasks: add-task-engine

## Deliverables

```yaml
- path: server/engine/manifest.ts
  kind: new
- path: server/engine/planner.ts
  kind: new
- path: server/engine/runner.ts
  kind: new
- path: server/engine/manifest.test.ts
  kind: new
- path: server/engine/planner.test.ts
  kind: new
- path: server/engine/runner.test.ts
  kind: new
- path: server/engine/runner.integration.test.ts
  kind: new
```

## 1. 清单加载

- [x] 1.1 编写 `server/engine/manifest.ts`：loadManifest（YAML 解析 → shared schema 校验 → 结构化错误：文件不存在/语法错误/校验失败任务定位）
- [x] 1.2 编写 `manifest.test.ts` 覆盖 task-manifest spec 全部场景

## 2. 执行规划

- [x] 2.1 编写 `server/engine/planner.ts`：detectCycle（含环路径输出）、topoSort（依赖先序 + 声明顺序稳定）、cascadeSelect（传递依赖补齐）、isBlocked（依赖未完成阻塞判定）
- [x] 2.2 编写 `planner.test.ts` 覆盖 execution-planner spec 全部场景

## 3. 执行状态机

- [x] 3.1 编写 `server/engine/runner.ts`：TaskRunner（队列物化、files→commands→verify 步骤、实时事件回调、失败停等、retry/skip/stop、snapshot）
- [x] 3.2 编写 `runner.test.ts`（内存假 executor/SFTP）覆盖状态机全部场景：成功流转、命令失败终止、上传失败、verify 失败、失败停等、重试继续、跳过继续、停止复位、实时事件、进度、快照
- [x] 3.3 编写 `runner.integration.test.ts`：对 ubuntu:24.04 sshd 集成容器跑真实命令队列（含故意失败命令的停等-重试流）
