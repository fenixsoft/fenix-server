# Linux 服务器初始化工具 — 设计文档

- 日期：2026-09-10
- 状态：设计已分节评审确认，待用户审阅终稿
- 项目代号：fenix-init

---

## 1. 背景与目标

用户有大量 Linux 服务器（Ubuntu）需要按统一清单初始化。现有 `task.md` 是一份人读的 Markdown 清单（APT 源、基础工具、ZSH 环境、Clash 代理、Docker、Claude Code 及插件等约 15 项任务），仅作为初始参考输入，产品完成后弃用。

**目标**：构建一个图形化初始化工具——

1. 将任务清单在界面中展示，用户勾选后一键执行，实时显示进度与输出
2. 提供 root 密码的 SSH 账号即可连接（密码认证）
3. 命令失败时可一键回退到服务器上的 Claude Code，在界面内嵌终端中交互式修复，修复后自动重试
4. 客户端本地代理可通过 SSH 反向隧道"带到"服务器，加速网络访问
5. 客户端程序跨 Windows / Linux 运行，浏览器操作

**非目标**（明确不做）：

- 多台服务器并行批量执行（明确为单台逐台操作）
- 服务器上的任务编排回传/分布式架构
- Electron/Tauri 桌面壳

---

## 2. 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 操作模式 | 单台逐台 | 用户确认；架构简化，代理端口固定 |
| 任务来源 | 结构化 YAML 清单，工具内置默认清单 | Markdown 解析脆弱；YAML 可表达依赖、文件、验证等元数据 |
| 失败回退 | 界面内嵌 PTY 交互式 Claude Code | 用户确认；全自动修复 |
| 形态 | Node.js 本地服务 + 浏览器 UI | 用户确认不用 Electron；浏览器操作即可 |
| 前端 | React 18 + Ant Design 5 + Vite | AntD 为硬性要求 |
| SSH 库 | `ssh2`（Node.js） | 密码认证、SFTP、反向隧道（`forwardIn`）、PTY 全部原生支持 |
| 语言 | TypeScript 全栈（server + web） | 单语言栈，类型复用（WebSocket 消息、任务 schema） |

---

## 3. 总体架构

```
┌─ 客户端机器（Windows / Linux 工作机）──────────────────┐
│                                                        │
│  浏览器 UI (React + AntD)                              │
│      │ HTTP（REST：配置/任务操作）                      │
│      │ WebSocket（日志流 / PTY 流 / 状态推送）          │
│      ▼                                                 │
│  Node.js 本地服务 (127.0.0.1:端口)                     │
│  ├─ 任务执行引擎（YAML 任务清单 → 拓扑排序 → 逐条执行）│
│  ├─ ssh2：命令执行 / SFTP 上传 / 反向隧道 / PTY        │
│  └─ 静态托管前端构建产物                                │
└──────┬─────────────────────────┬───────────────────────┘
       │ SSH（密码登录）          │
       ▼                         ▼
┌─ Linux 服务器 ─────────────────────────────────────────┐
│  命令执行（bash）  文件接收（/root/server-init/）       │
│  127.0.0.1:<隧道端口> ←─SSH -R 反向隧道─ 客户端本地代理 │
│  claude CLI ←─PTY 会话─ 界面内嵌交互                   │
└────────────────────────────────────────────────────────┘
```

**技术选型**：

| 层 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js 20+（LTS） | |
| Web 框架 | Fastify + `ws` | 轻量、静态托管 |
| SSH | `ssh2` | 见决策记录 |
| 前端 | React 18 + AntD 5 + Vite | |
| 终端渲染 | xterm.js | Claude PTY、日志显示 |
| 前端状态 | Zustand | 轻量 |
| 任务定义 | YAML（`yaml` 包） | 可注释、人可读 |
| 校验 | zod | 任务清单 schema 校验 |

**启动方式**：客户端机器安装 Node.js 后 `npm start`（编译产物 `node dist/server.js`），服务监听 `127.0.0.1` 并自动打开浏览器。单文件打包（Node SEA 等）留作二期可选。

---

## 4. 任务定义与执行引擎

### 4.1 任务清单 YAML Schema

```yaml
meta:
  name: fenix-server-init
  version: 1.0

tasks:
  - id: apt-aliyun-mirror        # 全局唯一
    title: 设置阿里云 APT 源
    group: 系统基础配置           # 界面分组
    description: 替换 Ubuntu 官方源为阿里云镜像
    commands:                     # 顺序执行，任一失败即任务失败
      - cp /etc/apt/sources.list /etc/apt/sources.list.bak
      - |
        cat > /etc/apt/sources.list << 'EOF'
        deb http://mirrors.aliyun.com/ubuntu/ jammy main restricted
        ...
        EOF
      - apt update
    verify: apt update            # 可选：验证命令，退出码 0 = 通过
    needs_proxy: false            # true 则执行时注入代理环境变量
    requires: []                  # 依赖的其他任务 id（可形成 DAG，禁止环）
    files: []                     # 执行前需上传的 assets 相对路径
    claude_hint: |                # 可选：失败回退 Claude 时的领域提示
      注意根据 /etc/os-release 的 VERSION_CODENAME 调整源代号
```

字段语义：

| 字段 | 语义 |
|---|---|
| `commands` | 顺序执行；任何一条退出码非 0 → 任务失败，停止该任务后续命令 |
| `verify` | 命令全部成功后执行，确认真实生效；失败同样判任务失败 |
| `needs_proxy` | 执行时注入 `http_proxy` / `https_proxy` / `HTTP_PROXY` / `HTTPS_PROXY` 指向 `http://127.0.0.1:<隧道端口>`；隧道未开启则自动先开隧道 |
| `requires` | 声明依赖；界面勾选自动级联勾选依赖；有未完成依赖的任务不可执行；解析时做环检测 |
| `files` | 执行前经 SFTP 上传到服务器 `/root/server-init/`（保持相对路径） |
| `claude_hint` | 附加到 Claude 修复提示词的领域上下文 |

### 4.2 执行语义

1. 用户勾选任务 → 引擎按 `requires` 拓扑排序生成执行队列（单队列串行，无并发）
2. 每个任务：上传 `files` → 逐条执行 `commands`（stdout/stderr 实时流式回传）→ 执行 `verify`
3. 状态机：

```
pending ──▶ running ──▶ success
               │  ▲
               ▼  │(修复后重试)
             failed ──▶ fixing ──┘
               │
               ▼
            skipped（用户跳过）
```

4. 失败任务**停在失败处等待用户决策**：界面提供「重试 / 交给 Claude 修复 / 跳过」；「跳过」后才继续队列中不依赖它的后续任务
5. Claude 修复流程：PTY 会话启动服务器上的 `claude --dangerously-skip-permissions`，提示词自动携带失败命令、完整错误输出、任务描述与 `claude_hint`；claude 进程退出后引擎自动重跑原任务 `commands`，成功则继续队列，失败则回到失败态
6. 幂等性由任务自身保证（`-y` 安装、先备份后覆盖等），引擎不做额外检测，失败重跑安全
7. 执行中可「停止」：关闭当前 exec channel 终止命令，当前任务回到 `pending`，队列清空

### 4.3 内置默认清单

工具内置由现 `task.md` 转换的 `assets/tasks.yaml`，要点：

- **`install-claude-code` 排在最前**（满足"先装 Claude Code，失败可回退"的要求），`needs_proxy: true`（NodeSource/npm 需网络），携带 `files: install-claude-code.sh、claude_settings/.claude.json、claude_settings/settings.json`
- Clash（`install-clash`）不再是其他任务的硬前置——所有需网络的命令统一走**工具的反向隧道**（`needs_proxy: true`）；Clash 作为服务器长期代理服务照常安装，任务 `git clone` 等在 Clash 就绪前即可通过隧道执行
- ZSH 插件（git clone GitHub）`needs_proxy: true`，依赖 Oh My Zsh 安装完成
- Docker / gh / Playwright / Superpowers / OpenSpec 均 `needs_proxy: true`
- `config-sshd`、APT 源、基础工具等无网络依赖任务保持无代理
- 转换产出的完整任务清单（id、依赖图、文件清单）在实施阶段提交实现计划时一并给出

---

## 5. SSH 层

单连接管理器封装 `ssh2.Client`：

| 能力 | 实现 |
|---|---|
| 连接 | 密码认证（`password`）；ready 超时 15s；键盘交互认证兼容 |
| 命令执行 | `exec(cmd)`，`pty: false`；合并捕获 stdout/stderr（分流标记），实时推送；结束回传退出码 |
| SFTP | `fastPut` 上传；递归目录自动 `mkdir -p` 语义 |
| 反向隧道 | `forwardIn('127.0.0.1', port)` 注册远程监听；`connection.on('connection')`（forwarded-tcpip）开 channel 与客户端本地代理 TCP 对接（纯字节流 pipe） |
| PTY | `shell({ pty })` 双向流，供 Claude 交互 |
| 心跳 | keepalive interval 30s，3 次无响应判死 |

---

## 6. 代理隧道

**链路**：

```
服务器命令 curl -x http://127.0.0.1:<P> ...
      ▼
服务器 127.0.0.1:<P>（forwardIn 注册的监听）
      ▼ SSH channel（复用已有 SSH 连接）
客户端 Node 服务 → net.connect(客户端本地代理)
      ▼ 纯字节流对接，不解析代理协议
客户端代理（HTTP / SOCKS 均可，Clash / v2ray 通用）
```

**端口策略**：隧道端口**避开 20122**（Clash 安装后自己占用）。默认从 30000 起探测空闲（服务器上 `ss -tln` 检测），被占自动换下一个。

**生命周期**：

- 不随 SSH 连接自动开启；用户点「开启代理隧道」或执行 `needs_proxy` 任务时按需建立
- 界面常驻指示器：`隧道 :<P> → 客户端代理 :<Q> ●已连通`；「测试」按钮在服务器执行 `curl -x http://127.0.0.1:<P> https://api.ipify.org` 回显出口 IP 验证链路
- SSH 断开 → 隧道随之失效；重连后自动重建

**容错**：

| 故障 | 处理 |
|---|---|
| 服务器端端口被占 | 自动换下一个端口 |
| 客户端代理不可达 | 隧道建立失败并明确报错，提示检查代理地址 |
| 隧道中途断开 | 执行中的 `needs_proxy` 任务按普通失败处理（可重试） |

---

## 7. 文件上传与资源

| 项 | 设计 |
|---|---|
| 资源来源 | 工具目录 `assets/`：`zsh_settings/.zshrc`、`zsh_settings/install_ohmyzsh.sh`、`claude_settings/.claude.json`、`claude_settings/settings.json`、`clash/config.yaml`（订阅配置）、`fenixserver_key.pub`、`install-claude-code.sh` |
| 目标位置 | 服务器 `/root/server-init/`，保持相对路径结构 |
| 触发时机 | 任务执行前自动上传其 `files` 列表；界面另提供「上传全部资源」按钮 |
| 方式 | SFTP `fastPut` 全量覆盖（文件均小，不做增量/哈希比对） |

初始 `assets/` 内容从用户现有 `/root/server-init/` 拷贝获得。

---

## 8. 前端设计

### 8.1 视图结构（React SPA）

**① 连接视图**（未连接时）：服务器选择/新增（名称、主机、端口、用户名、密码、记住密码）、客户端代理地址、任务清单选择（内置/自定义 YAML 路径）、「连接」按钮。

**② 任务执行视图**（连接后）：

```
┌─ 顶栏：root@1.2.3.4 ●已连接 │ 隧道:31222→:7890 ●已连通[测试] │ [断开] ─┐
├────────────┬───────────────────────────────────────────────────────────┤
│ [全选][清空]│  Tab: ● 执行日志   任务详情   ⚡Claude修复                  │
│ 进度 ▓▓▓░ 5/15 │                                                       │
│ [▶执行选中] │  ── [2/15] 安装常用工具 ───────────────  ✓ 成功 ──        │
│ [■停止]     │  $ apt install -y zip unzip ...                           │
│ ▼ 系统基础  │  Reading package lists... Done      exit 0                 │
│   ✓ 阿里源  │                                                           │
│   ⚡OhMyZsh │  ── [3/15] 安装 Oh My Zsh ─────────────  ✗ 失败 ──        │
│   ░ zsh插件 │  $ REPO=fenixsoft/ohmyzsh sh install_ohmyzsh.sh           │
│ ▶ 代理配置  │  [↻重试] [⚡交给Claude修复] [»跳过]                        │
├────────────┴───────────────────────────────────────────────────────────┤
│ 状态栏：SSH ●已连接 │ 隧道 ●开启 │ 当前: OhMyZsh │ 耗时 04:12           │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键交互**：

- 任务树按 `group` 分组折叠；每项 = 复选框 + 名称 + 状态图标（`░`待执行 `⟳`执行中 `✓`成功 `✗`失败 `⚡`修复中 `»`跳过）
- 勾选自动级联勾选 `requires` 依赖；依赖未完成的任务置灰不可勾
- 执行日志：虚拟滚动 + 自动滚底（用户上翻时暂停跟随、回底部恢复）；每条命令带分隔头（命令文本 + 退出码徽标）
- Claude 修复 Tab：激活时为 xterm.js 终端（PTY 双向），Claude 的提问直接在终端输入回答；底部辅助输入框同步向 PTY 写入
- 状态推送驱动全部 UI 更新（无轮询）

### 8.2 WebSocket 协议（前后端唯一实时通道）

| 方向 | 消息 |
|---|---|
| C→S | `connect`（凭据）、`exec(taskIds)`、`stop`、`retry(taskId)`、`skip(taskId)`、`fixWithClaude(taskId)`、`pty-input`、`tunnel-open`、`tunnel-test`、`disconnect` |
| S→C | `connection-status`、`task-state`（taskId+status）、`log`（taskId、stream、data）、`claude-output`、`tunnel-status`、`progress`（完成数/总数） |

消息类型定义为共享 TypeScript 类型（server/web 同仓引用）。

### 8.3 前端组件划分

```
web/src/
├── views/ConnectionView.tsx
├── views/TaskView.tsx
├── components/
│   ├── TaskTree.tsx           # 分组任务树 + 状态图标 + 级联勾选
│   ├── ExecutionToolbar.tsx   # 全选/清空/执行/停止 + 进度条
│   ├── LogViewer.tsx          # 虚拟滚动日志
│   ├── ClaudeTerminal.tsx     # xterm.js PTY 视图
│   ├── TaskDetailPanel.tsx    # 任务描述/命令/验证详情
│   └── TunnelIndicator.tsx    # 隧道状态 + 测试按钮
└── stores/appStore.ts         # Zustand：连接、任务、隧道、日志缓冲
```

---

## 9. 配置与安全

- 本地配置 `config.json`（工具目录）：服务器列表（名称/主机/端口/用户名）、客户端代理地址、最近任务清单路径
- **密码默认不保存**，每次连接输入；可选「记住」明文存本地，界面明确警示风险
- Node 服务只监听 `127.0.0.1`，不暴露局域网
- Claude PTY 启动时注入隧道代理环境变量（`HTTP_PROXY`/`HTTPS_PROXY`），保证服务器上 claude 可访问 API；隧道未开启且任务需要代理时先自动开隧道

---

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| SSH 连接失败 | 区分认证失败 / 网络不可达 / 超时，界面明确提示 |
| 命令失败（退出码非 0） | 任务失败态 + 日志红显 + 「重试/Claude 修复/跳过」 |
| 隧道建立失败 | 报错提示检查客户端代理；端口占用自动换端口 |
| Claude 修复后重跑仍失败 | 回到失败态，可再次修复或跳过 |
| Claude Code 未安装/不可用 | 提示先执行安装任务（内置清单已保证其最前）；仍可手动重试 |
| SSH 意外断线 | 运行中任务标记中断，提示重连；重连后隧道重建，任务可重新勾选执行 |
| 用户停止执行 | 终止当前命令，任务回 `pending`，队列清空 |

---

## 11. 测试策略

| 层 | 内容 |
|---|---|
| 单元测试（vitest） | YAML schema 校验、依赖环检测与拓扑排序、执行状态机转换、WebSocket 消息类型 |
| SSH 集成测试 | docker compose 起 openssh-server 容器（密码登录）：命令执行与流式输出、SFTP 上传、反向隧道（容器内 curl 宿主机 HTTP 服务）、PTY（跑 bash 脚本模拟） |
| 前端测试 | 关键组件渲染与交互（vitest + testing-library）：级联勾选、状态图标、失败动作按钮 |
| 手动验收 | 对一台真实 Ubuntu 服务器按内置清单全流程执行一遍 |

Claude 回退在集成测试中用 mock 脚本替代真实 `claude`（PTY 输出固定序列后退出）。

---

## 12. 项目结构

```
fenix-init/
├── server/
│   ├── index.ts          # 入口：Fastify 启动 + 静态托管 + 自动开浏览器
│   ├── ws.ts             # WebSocket 通道与消息路由
│   ├── ssh/
│   │   ├── connection.ts # ssh2 连接管理
│   │   ├── executor.ts   # 命令执行 + 流式输出
│   │   ├── sftp.ts       # 文件上传
│   │   ├── tunnel.ts     # 反向隧道
│   │   └── pty.ts        # Claude PTY 会话
│   ├── engine/
│   │   ├── schema.ts     # YAML 清单加载 + zod 校验
│   │   ├── planner.ts    # 环检测 + 拓扑排序
│   │   └── runner.ts     # 执行状态机
│   └── config.ts         # config.json 读写
├── web/                  # React + AntD（Vite，构建产物由 server 托管）
│   └── src/…             # 见 8.3
├── shared/
│   └── messages.ts       # WebSocket 消息与任务类型（前后端共用）
├── assets/
│   ├── tasks.yaml        # 内置默认任务清单
│   ├── zsh_settings/.zshrc
│   ├── zsh_settings/install_ohmyzsh.sh
│   ├── claude_settings/.claude.json
│   ├── claude_settings/settings.json
│   ├── clash/config.yaml
│   ├── fenixserver_key.pub
│   └── install-claude-code.sh
├── config.json           # 运行时生成
├── package.json          # workspace（server + web + shared）
└── docker-compose.test.yml
```

---

## 13. 开放事项（实施前确认）

1. `assets/clash/config.yaml` 订阅配置需用户提供（从现有服务器拷贝），工具不内置
2. 内置清单的完整任务列表与依赖图在实现计划阶段产出并复核
3. `claude --dangerously-skip-permissions` 的使用（修复流程不卡权限确认）需用户知悉确认
