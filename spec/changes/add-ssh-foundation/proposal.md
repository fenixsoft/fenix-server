# Proposal: add-ssh-foundation

## Why

fenix-server 项目要构建图形化 Linux 服务器初始化工具（设计文档：`docs/superpowers/specs/2026-09-10-server-init-tool-design.md`）。所有功能（任务执行、代理隧道、Claude 回退、前端 UI）都依赖一个共同的地基：Node 本地服务骨架、与 Linux 服务器的 SSH 连接能力（密码认证/命令执行/文件上传）、以及前后端共享的消息与任务契约。本 SPEC 优先落地这一层，是后续全部 SPEC 的前置。

## What Changes

- 新建 TypeScript monorepo 骨架：`server/`（Fastify + ws）、`web/`（占位，由 add-web-ui 实现）、`shared/`（前后端共用类型）
- 新建 Fastify 本地服务：只监听 `127.0.0.1`，静态托管前端构建产物，WebSocket 实时通道与消息路由
- 新建 `shared/messages.ts`：定义全部 WebSocket 消息类型（C→S / S→C）与任务相关共享类型（设计文档 §8.2）
- 新建 `shared/schema.ts`：任务清单 YAML 的 zod schema 与类型导出（字段语义见设计文档 §4.1；校验逻辑的消费方是 add-task-engine）
- 新建 ssh2 封装层 `server/ssh/`：密码认证连接管理（心跳、断线事件）、命令执行器（stdout/stderr 分流、实时流式回调、退出码）、SFTP 上传（`fastPut` + 递归 mkdir）
- 新建 `server/config.ts`：本地 `config.json` 读写（服务器列表、客户端代理地址、最近任务清单路径；密码默认不保存，可选明文记住）
- 新建 docker compose 测试环境 `docker-compose.test.yml`（基底 `ubuntu:24.04` 的 openssh-server 容器，密码登录，与 E2E 验证镜像同源）与 SSH 层集成测试

## Capabilities

### New Capabilities

- `service-foundation`: Node.js 本地服务骨架——Fastify 启动、仅监听 127.0.0.1、静态托管、WebSocket 通道与消息路由、config.json 本地配置读写、进程入口与自动打开浏览器
- `ssh-core`: SSH 核心能力——基于 ssh2 的密码认证连接管理（状态机、心跳、断线事件）、命令执行器（流式输出分流、退出码）、SFTP 文件与目录上传
- `shared-contracts`: 前后端共享契约——WebSocket 消息类型定义、任务清单 YAML schema（zod）与 TypeScript 类型，被全部后续 SPEC 引用

### Modified Capabilities

（无——全新项目，无既有能力）

## Impact

- 新增依赖：`fastify`、`@fastify/static`、`ws`、`ssh2`、`zod`、`yaml`、`typescript`、`vitest` 及类型包
- 新增文件：`server/`、`shared/`、`docker-compose.test.yml`、`package.json`（workspace）、`tsconfig*.json`
- 不修改既有文件（当前仓库仅含 task.md 与设计文档）
- 后续 SPEC（add-task-engine / add-proxy-tunnel / add-web-ui / add-claude-fallback / add-builtin-tasks-e2e）全部依赖本 SPEC 的产物
