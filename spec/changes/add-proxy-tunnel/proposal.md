# Proposal: add-proxy-tunnel

## Why

初始化任务中大量步骤需要访问海外网络资源（GitHub、Docker 官方源、npm 等），国内服务器直连缓慢或不可达。用户客户端工作机（Windows/Linux）上运行着代理（Clash/v2ray 等），本 SPEC 通过 SSH 反向隧道把客户端代理"带到"服务器：服务器上以 `127.0.0.1:<隧道端口>` 为代理出口，流量经 SSH 隧道回到客户端、由客户端代理发出。这解除了"服务器先装 Clash 才能装其他软件"的顺序约束，配合任务引擎的 `needs_proxy` 标记实现零手工配置的网络加速。

## What Changes

- 新增 `server/ssh/tunnel.ts`：基于 ssh2 `forwardIn` 的反向隧道管理——在服务器 `127.0.0.1` 上注册远程监听，`forwarded-tcpip` channel 与客户端本地代理 TCP 对接（纯字节流 pipe）
- 端口策略：从 30000 起探测服务器侧空闲端口（`ss -tln` 检测），**避开 20122**（Clash 安装后占用），被占自动换下一个
- 生命周期：显式开启/关闭 API；SSH 断线隧道随之失效，重连后可重建；同一时刻最多一条隧道
- 代理注入：`needs_proxy: true` 的命令执行前自动确保隧道已开启，并以环境变量注入 `http_proxy`/`https_proxy`/`HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:<隧道端口>`（对任务引擎 executor 的包装）
- 诊断：隧道状态事件（开启/关闭/错误，含实际端口）、连通性测试（服务器上 `curl -x http://127.0.0.1:<P> https://api.ipify.org` 返回出口 IP）

## Capabilities

### New Capabilities

- `reverse-tunnel`: SSH 反向隧道——forwardIn 注册远程监听、channel 与客户端代理字节流对接、端口探测策略（避开 20122）、生命周期与 SSH 断线联动
- `proxy-injection`: 代理环境变量注入——`needs_proxy` 任务执行前自动确保隧道开启并注入代理环境变量
- `tunnel-diagnostics`: 隧道诊断——状态事件流与连通性测试（出口 IP 回显）

### Modified Capabilities

（无——对 add-task-engine 执行器的增强以包装形式实现，不改变其已发布需求语义）

## Impact

- 新增文件：`server/ssh/tunnel.ts`、`server/ssh/proxy-inject.ts` 及测试
- 依赖 add-ssh-foundation（SshConnection）与 add-task-engine（runner 的命令执行包装点）
- 被 add-web-ui（隧道指示器/测试按钮）、add-claude-fallback（claude 进程代理注入）依赖
