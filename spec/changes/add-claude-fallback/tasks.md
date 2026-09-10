# Tasks: add-claude-fallback

## Deliverables

```yaml
- path: server/ssh/pty.ts
  kind: new
- path: server/engine/fixer.ts
  kind: new
- path: server/ssh/pty.test.ts
  kind: new
- path: server/engine/fixer.test.ts
  kind: new
- path: server/ssh/fixtures/mock-claude.sh
  kind: new
```

## 1. PTY 会话层

- [x] 1.1 编写 `server/ssh/pty.ts`：PtySession（open/write/resize/close、输出分片回调、退出码检测、主动终止、连接复用）
- [ ] 1.2 编写 `pty.test.ts`（ubuntu:24.04 sshd 集成容器 + mock 脚本）：输出/退出检测、stdin 写入回显、主动终止、连接复用

## 2. 修复编排

- [ ] 2.1 编写 `server/engine/fixer.ts`：fixer.start（可用性检测 → 上下文提示词构造 8KB 截断 → PTY 启动 claude → fixing 状态 → 输出转发 → 退出自动 retry）、abort、单会话约束、claude 缺失明确报错
- [ ] 2.2 编写 `server/ssh/fixtures/mock-claude.sh`：可配置行为的 mock（输出序列、stdin 回显、退出码、argv/prompt 记录到文件）
- [ ] 2.3 编写 `fixer.test.ts`：提示词完整性、fixing 状态、修复成功队列继续、重跑仍失败回 failed、中止回退、单会话拒绝、claude 缺失报错
