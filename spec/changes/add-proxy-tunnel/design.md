# Design: add-proxy-tunnel

## Context

依赖 add-ssh-foundation 的 SshConnection（单连接多 channel）与 add-task-engine 的执行器。设计文档 §6 已确定链路：服务器 `127.0.0.1:<P>`（forwardIn 监听）→ SSH channel → 客户端 `net.connect(本地代理)` → 客户端代理，全程字节流 pipe，不解析代理协议（HTTP/SOCKS 通用）。

## Goals / Non-Goals

**Goals:**

- `TunnelManager`：`open()` / `close()` / `status`；open 时探测端口→forwardIn 注册→监听 `connection` 事件逐 channel 对接客户端代理
- 端口策略：30000 起、`ss -tln` 探测、跳过 20122、被占自动换；实际端口随状态事件上报
- `withProxy(task, execFn)` 注入包装：`needs_proxy` 时确保隧道开启（未开则自动 open）并以代理环境变量执行命令
- `testConnectivity()`：服务器执行 `curl -x` 访问 `https://api.ipify.org`，超时 10s，返回出口 IP 或失败原因
- SSH `close` 事件联动：隧道置为失效并发射状态事件

**Non-Goals:**

- 多隧道/多代理链（单隧道）
- 代理协议感知（认证、协议校验）——客户端代理若需认证不在支持范围（用户本地代理通常免认证）
- 服务器侧 Clash 服务的安装编排（属内置任务清单，与本隧道机制独立并存）
- SOCKS/HTTP 差异化处理（pipe 层不区分）

## Decisions

1. **channel 对接用原生 `net.connect` + `pipe`**：ssh2 `connection` 事件给出 duplex stream，直接与到客户端代理的 socket 互 pipe；任一端关闭即销毁另一端。理由：零协议逻辑，错误处理点最少。
2. **端口探测在服务器执行 `ss -tln` 解析**而非盲目 forwardIn 试错。理由：forwardIn 端口冲突会产生难以区分的错误事件；`ss -tln` 一次拿到监听全集，本地过滤后一次注册成功率高。forwardIn 失败仍兜底换端口重试（最多 5 次）。
3. **注入实现为环境变量前缀而非修改任务清单**：`withProxy` 在命令串前拼接 `env` 前缀（`http_proxy=... https_proxy=... HTTP_PROXY=... HTTPS_PROXY=...` + 原命令，经 `env` 命令注入），不污染远端 shell 配置。理由：最小影响面，任务原文不变，git 全局代理等持久配置由内置任务清单自己的步骤负责。
4. **诊断用 ipify 而非通用 URL**：固定、无依赖、返回即出口 IP，能同时验证"服务器→隧道→客户端代理→外网"全链路。

## Risks / Trade-offs

- [客户端代理地址不可达时 channel 建立失败] → open 阶段即验证客户端代理 TCP 可达（本地 net.connect 试连），失败报"检查客户端代理"；运行中失败按 channel 错误记录并继续（不炸隧道）
- [`ss` 在极老系统缺失] → 兜底路径：直接尝试 forwardIn，失败换端口
- [隧道空闲不主动保活] → 依赖 SSH keepalive（connection 层已有）；SSH 断开→隧道失效→重连后需手动/按需重建（设计文档 §6 已定）

## Migration Plan

全新模块，无迁移。

## Open Questions

无。
