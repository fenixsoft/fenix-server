# Tasks: add-proxy-tunnel

## Deliverables

```yaml
- path: server/ssh/tunnel.ts
  kind: new
- path: server/ssh/proxy-inject.ts
  kind: new
- path: server/ssh/tunnel.test.ts
  kind: new
- path: server/ssh/proxy-inject.test.ts
  kind: new
```

## 1. 反向隧道核心

- [ ] 1.1 编写 `server/ssh/tunnel.ts`：TunnelManager（open/close/status、端口探测 `ss -tln` 跳过 20122、forwardIn 兜底重试、channel↔客户端代理 pipe 对接、SSH 断线联动、状态事件）
- [ ] 1.2 编写 `tunnel.test.ts`（ubuntu:24.04 sshd 集成容器 + 宿主机 mock 代理）：全链路代理请求、channel 清理、端口选择/顺延/跳过 20122、重复 open、断线失效、显式关闭注销监听

## 2. 代理注入

- [ ] 2.1 编写 `server/ssh/proxy-inject.ts`：withProxy 包装（needs_proxy 自动开隧道、四变量注入、命令原文不变、客户端代理不可达明确报错）
- [ ] 2.2 编写 `proxy-inject.test.ts`：注入执行、未标记不注入、自动开隧道、代理不可达报错

## 3. 诊断

- [ ] 3.1 在 tunnel.ts 中实现状态事件转译与 testConnectivity（curl -x ipify、10s 超时、未开启快速失败）
- [ ] 3.2 补充 tunnel.test.ts 对应场景断言
