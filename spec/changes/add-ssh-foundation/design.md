# Design: add-ssh-foundation

## Context

全新仓库（仅含 `task.md` 与设计文档）。本 SPEC 建立 fenix-server 工具的地基层：Node 本地服务 + SSH 能力 + 前后端共享契约。整体架构、技术选型已在设计文档 §2/§3 评审确定：TypeScript 全栈、Fastify + ws、ssh2、zod、Vite（web 部分由 add-web-ui 负责，本 SPEC 只留占位）。

约束：

- 服务只监听 `127.0.0.1`（安全要求，设计文档 §9）
- 目标服务器为 Ubuntu，root + 密码认证
- 集成测试用 docker 起 openssh-server 容器（密码登录），不依赖真实服务器

## Goals / Non-Goals

**Goals:**

- TypeScript workspace 骨架（server / shared / web 占位）可构建、可测试
- Fastify 服务：静态托管目录（web 构建产物，先占位）、`/ws` WebSocket 端点、消息路由框架（按 `type` 字段分发，可注册 handler）
- ssh2 封装：连接生命周期管理（connecting/ready/closed/error 状态、keepalive、断线事件）、命令执行（实时 stdout/stderr 分流回调 + 退出码）、SFTP 上传（单文件 + 递归目录，自动创建远端目录）
- zod 任务 schema：按设计文档 §4.1 字段（id/title/group/description/commands/verify/needs_proxy/requires/files/claude_hint）校验并导出类型；`requires` 环检测**不在本 SPEC**（属 add-task-engine 的 planner）
- `config.json` 读写：服务器列表（name/host/port/username/rememberPassword 可选 password）、clientProxy 地址、lastTaskManifestPath

**Non-Goals:**

- 反向隧道（add-proxy-tunnel）
- PTY / Claude 会话（add-claude-fallback）
- 任务加载/校验执行/拓扑排序（add-task-engine）
- 前端页面（add-web-ui；本 SPEC 仅保证静态目录存在时能托管）
- 密码加密存储（明文可选记住 + 界面警示已由设计确定）

## Decisions

1. **pnpm/npm workspace 单仓（server + shared + web）**：shared 以源码形式被 server 与 web 直接引用（`tsconfig` paths + 构建时打包），不发包。理由：单人项目，避免发布流程；类型与消息契约天然同源。
2. **ssh2 连接封装为单一类 `SshConnection`**：内部持有 `ssh2.Client`，对外暴露 `connect()/exec()/sftpUpload()/close()` 与事件（`status`、`close`）。理由：后续隧道、PTY 都复用同一连接实例（ssh2 多 channel 复用单 TCP 连接），单类管理生命周期最简单；不引入连接池（单台逐台操作）。
3. **命令执行用 `exec` with stream 回调，不用 `shell`**：每条命令独立 `exec`，`stream` 事件回调 stdout/stderr 分片（带分流标记），close 事件给退出码。理由：退出码语义清晰、避免 shell 会话状态泄漏；PTY 仅 Claude 交互需要（另一个 SPEC）。
4. **WebSocket 消息 = `{ type: string; payload: unknown }` 判别联合**：`shared/messages.ts` 导出 `ClientMessage` / `ServerMessage` 联合类型与各消息接口；server 端路由器按 type 查 handler 表，未知 type 回 `error` 消息。理由：类型安全、前后端共用、易扩展（后续 SPEC 只加消息类型 + handler）。
5. **config 读写同步 JSON 文件 + 进程内缓存**：`config.json` 位于工具目录（运行时生成，gitignore），`load/save` 直接 `JSON.parse/stringify`。理由：数据量极小，无需 sqlite；并发写仅来自单进程。
6. **集成测试容器统一基底 `ubuntu:24.04`（用户已拉取该镜像）**：`Dockerfile.sshd` 以 ubuntu:24.04 为底座安装 openssh-server（root 密码登录、前台 sshd，无需 systemd），由 `docker-compose.test.yml` 编排，实现期配合 testcontainers Node 库或 docker CLI 获得确定性等待。理由：与 E2E 验证环境（add-builtin-tasks-e2e）同源，单一镜像族。

## Risks / Trade-offs

- [ssh2 在 Node 20 的原生依赖问题（http2 可选依赖）] → 使用纯 JS 主路径；`package.json` 锁定 ssh2 ^1.x，CI 跑通安装即视为验证
- [容器内 sshd 就绪时序不稳定导致测试 flaky] → testcontainers 等待策略（端口可达 + 尝试认证成功为准），失败自动重试一次
- [stdout/stderr 分片乱序] → 接受（设计如此）：日志带 stream 标记，前端按到达顺序渲染；不为排序引入缓冲延迟
- [web/ 目录本 SPEC 未实现导致静态托管无产物] → 托管目录不存在时服务正常启动并返回占位页，不报错

## Migration Plan

全新项目，无迁移。回滚 = 删除新增目录与依赖。

## Open Questions

无（设计文档 §13 开放事项均不阻塞本 SPEC：订阅配置属 add-builtin-tasks-e2e；内置清单属 add-builtin-tasks-e2e；`--dangerously-skip-permissions` 属 add-claude-fallback）。
