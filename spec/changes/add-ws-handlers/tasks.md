## Deliverables

```yaml
- path: server/handlers.ts
  kind: new
- path: server/handlers.test.ts
  kind: new
- path: server/handlers.integration.test.ts
  kind: new
- path: server/index.ts
  kind: modify
```

## 1. 会话上下文与 handler 装配骨架

- [x] 1.1 新建 `server/handlers.ts`：SessionContext（connection/runner/fixer/tunnel 生命周期与互斥）、事件翻译绑定与清理（统一 removeAllListeners/off 防泄漏）、broadcast（readyState 检查）
- [x] 1.2 实现 `registerSessionHandlers(router, deps)` 装配入口，deps 注入 AppConfigManager/assets 清单路径/工作目录，供测试替换 fake
- [x] 1.3 `server/index.ts` 装配真实 handler 集（替换空 router），保留既有静态托管与优雅退出

## 2. connect/disconnect 与清单加载

- [x] 2.1 `connect` handler：payload 建连（connecting/ready/error + AUTH_FAILED/UNREACHABLE/TIMEOUT 错误码）、已有会话拒绝（SESSION_EXISTS）
- [x] 2.2 清单来源：payload 携带 YAML 文本 → schema 校验（MANIFEST_INVALID 含错误路径）；缺省读 `assets/tasks.yaml`；连接成功后建立 runner 上下文并回发任务快照
- [x] 2.3 `disconnect` handler：终止执行/修复、关隧道、关 SSH、重置上下文，回 connection-status (disconnected)；无会话时幂等
- [x] 2.4 WebSocket 断开兜底清理（ws close 事件触发与 disconnect 相同的清理路径）

## 3. 执行控制与事件广播

- [x] 3.1 `exec` handler：依赖闭包校验（BLOCKED_TASK 拦截）、物化队列并启动 runner；`task-state`/`log`/`progress` 事件实时广播
- [x] 3.2 `stop`/`retry`/`skip` handler：状态机合法性检查（NO_SESSION/非 awaiting-decision 回 error），stopped-state/queue-finished 翻译为最终一致 task-state + progress 重放
- [x] 3.3 `snapshot` handler：全量快照回发（task-state × N + progress + tunnel-status）；无会话回空态快照不报错

## 4. Claude 修复与隧道接线

- [x] 4.1 `fixWithClaude` handler：委托 Fixer.start（非 failed 回 error、CLAUDE_UNAVAILABLE 可区分），`claude-output` 事件实时广播，修复结束与 runner 状态联动
- [x] 4.2 `pty-input` handler：写入活跃修复会话（无会话 NO_SESSION 回 error）
- [x] 4.3 `tunnel-open`/`tunnel-test` handler：委托 TunnelManager（未连接回 error），status 事件主动推送，testConnectivity 结果经 tunnel-status 回传（出口 IP/失败原因）

## 5. 测试与验证

- [x] 5.1 `server/handlers.test.ts`：fake 引擎注入的 handler 单元测试（消息→行为→send 序列断言，覆盖 spec 全部场景）
- [x] 5.2 `server/handlers.integration.test.ts`：docker compose SSH 测试容器的真实连接集成测试（connect→exec→stop/retry→tunnel→disconnect 主干链）
- [x] 5.3 全量回归：server 与 web 既有测试套通过，`npm run build` 产物可启动并提供 /ws 服务
