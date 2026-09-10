# 手动验收清单（真实 Ubuntu 服务器）

本清单用于对**真实 Ubuntu 服务器**进行 add-builtin-tasks-e2e 的全流程验收。
自动化验证（tests/e2e/）已覆盖容器内的初始化执行；本清单覆盖自动化之外的
真实场景：真实 Claude 修复、真实 Clash 订阅配置、真实代理模式、业务可用性。

---

## 0. 环境要求

| 项 | 要求 |
|----|------|
| 操作系统 | Ubuntu 22.04 / 24.04（64 位） |
| 网络 | 可访问 mirrors.aliyun.com；海外任务需代理 |
| Docker | 可选（仅自动化验证需要，手动验收不需要） |
| Claude CLI | 已安装可用（真实修复路径需要） |
| 代理订阅 | 可选；缺失时 install-clash 会失败，见 §3 |

软件服务监听端口（验收时会用到）：

| 端口 | 用途 |
|------|------|
| 20122 | Clash/mihomo 混合代理端口 |
| 9090 | Clash 外部控制面板 |
| 22 | SSH |

---

## 1. 准备

1. 拷贝内置清单与资源到服务器：
   ```bash
   # 在开发者机器上
   scp -r assets/ root@<server>:/root/server-init/
   ```
2. **订阅配置**（有订阅时）：将用户的实际 Clash 订阅拷贝为清单引用的资源：
   ```bash
   # 服务器上（若 /root/.config/clash/config.yaml 已存在且有订阅）
   cp /root/.config/clash/config.yaml /root/server-init/clash/config.yaml
   ```
   > 若没有订阅配置，保持占位配置文件（proxies: []）即可，
   > 但 §2 第 6 步 install-clash 会失败（systemctl start clash 无法启动），
   > 此时按流程跳过该任务即可（见 §3）。

3. （可选）准备 SSH 公钥：资源 `fenixserver_key.pub` 默认包含示例公钥，
   替换为你的真实公钥后再执行 config-sshd。

---

## 2. 全流程执行验收

通过本地终端执行的流程路径：

1. **安装 Claude Code**（最先）：确认清单执行顺序中 install-claude-code
   排在最前、无前置依赖（依赖图根任务）。
2. **连接服务器**：用本工具的连接功能以 root/密码连到目标服务器。
3. **选择内置清单**：加载 `/root/server-init/assets/tasks.yaml`（或通过
   `node dist/server/index.js` 启动的服务端默认内置清单）。
4. **执行全量任务**：全选并执行。逐任务确认状态为 success。
5. **核对关键产物**（任一失败即验收失败）：

   ```bash
   # APT 源指向阿里云
   grep -q mirrors.aliyun.com /etc/apt/sources.list && echo "APT源 OK"
   # Git 全局配置
   git config --global --list | grep -qE 'user.name|user.email' && echo "Git OK"
   # ZSH 默认 shell
   [ "$(getent passwd root | cut -d: -f7)" = "$(which zsh)" ] && echo "ZSH OK"
   # Oh My Zsh + 插件
   ls -d ~/.oh-my-zsh ~/.oh-my-zsh/custom/plugins/zsh-autosuggestions ~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting >/dev/null && echo "OMZ OK"
   # .zshrc 就位
   grep -q '^plugins=(' ~/.zshrc && echo "ZSHRC OK"
   # Docker CLI
   docker --version >/dev/null 2>&1 && echo "Docker OK"
   # gh
   gh --version >/dev/null 2>&1 && echo "gh OK"
   # Playwright CLI（含浏览器可按需验证）
   playwright --version >/dev/null 2>&1 && playwright-cli --version >/dev/null 2>&1 && echo "Playwright OK"
   # Superpowers 插件
   ls -d ~/.claude/plugins/installed/superpowers >/dev/null 2>&1 && echo "Superpowers OK"
   # OpenSpec
   openspec --version >/dev/null 2>&1 && echo "OpenSpec OK"
   # SSH：公钥授权 + 配置
   grep -qE '^PermitRootLogin yes' /etc/ssh/sshd_config && grep "$(cat /root/server-init/fenixserver_key.pub)" ~/.ssh/authorized_keys >/dev/null && echo "SSHD OK"
   # Clash（有订阅时）
   systemctl is-active clash 2>/dev/null | grep -q active && echo "Clash OK"
   # Claude Code 已安装（真实安装过）
   command -v claude >/dev/null && echo "Claude Code OK"
   ```

6. **验证 verify 环节**：每个任务执行后确认 verify 命令通过（工具界面
   中该任务状态为 success 即隐含 verify 通过）。

---

## 3. 已知限制与处置

### install-clash 的订阅配置缺失

- 现象：`systemctl start clash` 失败（占位配置无可用节点），任务标红。
- 处置：在工具中对该任务执行 **跳过**（skip），其余任务继续执行。
- 说明：此场景已在 tasks.yaml 的 `claude_hint` 注明；不影响其他任务
  的代理——其他海外任务走**反向隧道**（客户端代理），不依赖服务器 Clash。

### 真实代理模式（E2E_PROXY）

自动化 E2E 中，无 `E2E_PROXY` 时使用本地 mock-proxy（仅记录请求，转发到
真实网络）。**手动/夜间完整出网验证**时设置真实代理：

```bash
E2E_PROXY=socks5://127.0.0.1:13579 npx vitest run tests/e2e/e2e.test.ts
```

此时 needs_proxy 任务经 `E2E_PROXY` 真实出网（GitHub 限速等真实可达性
不作为自动化断言，见 design.md §Decisions.3）。

---

## 4. Claude 修复路径演练（真实 claude）

> 前提：服务器已安装 Claude CLI（第 1 步 install-claude-code）且
> **开发者机器**的 claude 可访问 API。

1. **制造一个失败**：任选一个本地可复现失败的任务
   （如临时改坏一条 verify 命令，或断网重试海外任务）。
2. **交给 Claude 修复**：工具界面中点击该失败任务的「交给 Claude 修复」。
3. **观察修复会话**：服务器侧进入 claude 交互（隧道打通，命令行可用）：
   - 确认提示词包含：任务标题、失败阶段、错误输出尾部、`claude_hint`
     （存在时）。
   - Claude 在服务器上执行修复命令。
4. **修复后自动重跑**：Claude 修复完成后，该任务被自动重试
   （retryAfterFix 机制）；确认从 `fixing` 恢复为 `running` 再 `success`。
5. **演练目标**：验证「失败 → 交给 Claude → 修复 → 自动重试 →
   成功」闭环在真实 claude + 真实服务器上成立。

> 自动化环境使用 `server/ssh/fixtures/mock-claude.sh` 演练同一闭环
> （逻辑等价，无真实 API 调用）。

---

## 5. 代理桩链路验证（可选，自动化已覆盖）

- 已确认 needs_proxy 任务（git clone / npm install / curl 海外）在执行时
  请求出现在本地 mock-proxy 记录中（`GET /__records` 可查询），
  证明这些任务真实经过反向隧道出网。
- 手动可复核：隧道开启后，在服务器执行
  `curl -x http://127.0.0.1:<隧道端口> https://api.ipify.org`，
  返回的是客户端代理出口 IP 而非服务器源 IP 即证明链路正确。

---

## 6. 验收通过标准

- [ ] 全量任务 success（除订阅缺失导致的 install-clash skip 外无不成功任务）
- [ ] §2 第 5 步关键产物全部回显 OK
- [ ] §4 Claude 修复闭环完成一次真实演练
- [ ] （可选）有订阅时 `systemctl is-active clash` 为 active，
      并且 Clash 面板 http://127.0.0.1:9090 可访问