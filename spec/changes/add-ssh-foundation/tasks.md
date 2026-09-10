# Tasks: add-ssh-foundation

## Deliverables

```yaml
- path: package.json
  kind: new
- path: tsconfig.base.json
  kind: new
- path: tsconfig.server.json
  kind: new
- path: shared/messages.ts
  kind: new
- path: shared/schema.ts
  kind: new
- path: server/index.ts
  kind: new
- path: server/ws.ts
  kind: new
- path: server/config.ts
  kind: new
- path: server/ssh/connection.ts
  kind: new
- path: server/ssh/executor.ts
  kind: new
- path: server/ssh/sftp.ts
  kind: new
- path: docker-compose.test.yml
  kind: new
- path: tests/sshd/Dockerfile.sshd
  kind: new
- path: server/ssh/connection.test.ts
  kind: new
- path: server/ssh/executor.test.ts
  kind: new
- path: server/ssh/sftp.test.ts
  kind: new
- path: shared/schema.test.ts
  kind: new
- path: server/ws.test.ts
  kind: new
- path: server/config.test.ts
  kind: new
```

## 1. 工程骨架

- [ ] 1.1 初始化 npm workspace：`package.json`（scripts：build/test/start）、`tsconfig.base.json`、`tsconfig.server.json`，安装 fastify/@fastify/static/ws/ssh2/zod/yaml/typescript/vitest 及类型依赖
- [ ] 1.2 建立 `shared/`、`server/` 目录结构与路径别名（shared 以源码引用），验证空构建与空测试跑通

## 2. 共享契约

- [ ] 2.1 编写 `shared/messages.ts`：C→S / S→C 消息判别联合与 payload 类型（覆盖 spec 列出的全部消息名）
- [ ] 2.2 编写 `shared/schema.ts`：任务清单 zod schema（含 id 唯一性、requires 存在性、commands 非空校验与默认值填充、错误列表输出）
- [ ] 2.3 编写 `shared/schema.test.ts`：合法清单、重复 id、未知依赖、空命令四个场景的单测

## 3. SSH 核心层

- [ ] 3.1 编写 `server/ssh/connection.ts`：SshConnection 类（密码认证、状态机、可区分错误类别、keepalive、closed 事件、资源清理）
- [ ] 3.2 编写 `server/ssh/executor.ts`：命令执行器（stdout/stderr 分流实时回调、退出码、channel 复用顺序执行、关闭后报错）
- [ ] 3.3 编写 `server/ssh/sftp.ts`：单文件 fastPut 上传与递归目录上传（自动创建远端目录）
- [ ] 3.4 编写 `tests/sshd/Dockerfile.sshd`（基底 ubuntu:24.04：安装 openssh-server、root 密码登录、随机密码注入、前台 sshd）与 `docker-compose.test.yml` 编排及容器等待工具
- [ ] 3.5 编写集成测试 `connection.test.ts` / `executor.test.ts` / `sftp.test.ts` 覆盖 ssh-core spec 全部场景

## 4. 服务基础

- [ ] 4.1 编写 `server/config.ts`：config.json 加载/保存（默认空配置、原子写入），配套 `config.test.ts`
- [ ] 4.2 编写 `server/ws.ts`：/ws WebSocket 端点、按 type 分发的消息路由器（未知类型回 error、非法 JSON 容错），配套 `ws.test.ts`
- [ ] 4.3 编写 `server/index.ts`：服务入口（仅监听 127.0.0.1、静态托管占位兜底、SIGTERM 优雅退出、自动打开浏览器留接口）
