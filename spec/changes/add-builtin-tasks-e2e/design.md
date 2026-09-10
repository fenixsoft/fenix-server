# Design: add-builtin-tasks-e2e

## Context

收官 SPEC：内置清单 + 资源 + 端到端验证。用户明确要求验证方案以 `ubuntu:24.04` Docker 镜像生成容器进行实际初始化测试（镜像已拉取）。设计文档 §4.3 已定清单要点（Claude Code 最前、隧道替代 Clash 顺序依赖），本 SPEC 落地并给出可回归的验证设施。

## Goals / Non-Goals

**Goals:**

- `assets/tasks.yaml`：约 15 个任务、完整依赖图；id 命名与设计文档 §4.3 一致（`install-claude-code`、`apt-aliyun-mirror`、`install-base-tools`、`config-git`、`install-python`、`install-zsh`、`install-ohmyzsh`、`install-zsh-plugins`、`install-fzf`、`config-zshrc`、`install-clash`、`install-docker`、`install-gh-cli`、`install-playwright`、`install-superpowers`、`install-openspec`、`config-sshd`）
- 端到端验证设施（`tests/e2e/`），两级容器形态：
  - **集成级**（供前序 SPEC 单元/集成测试复用）：ubuntu:24.04 + `openssh-server`（entrypoint 安装并直接前台启动 sshd，root 密码登录，无需 systemd）——`tests/e2e/Dockerfile.sshd`
  - **E2E 级**（真实初始化）：ubuntu:24.04 特权容器 + systemd 为 PID1（`--privileged`、cgroup 挂载、`/sbin/init` 启动），容器内预装 openssh-server 并 `systemctl enable ssh`——`tests/e2e/Dockerfile.systemd` + compose 编排；此形态可真实执行 `systemctl` 类任务（clash/ssh 服务）
- 代理桩：`tests/e2e/mock-proxy.mjs`（Node 本地 HTTP 代理转发器，记录收到的 CONNECT/GET），E2E 中作为"客户端代理"验证 needs_proxy 任务确实经隧道出网；有真实代理时可用 `E2E_PROXY` 环境变量替换
- 断言策略：逐任务断言 `success`；`verify` 命令在容器内复核（如 `getent passwd root`、`git config --global --list`、`docker --version`、`zsh --version`）
- `docs/acceptance.md`：手动验收清单（真实服务器全流程 + Claude 修复路径人工演练）

**Non-Goals:**

- E2E 中真实 claude API 调用（修复路径用 mock-claude.sh 演练；真实修复属手动验收）
- 多 Ubuntu 版本矩阵（24.04 基准；22.04 差异记录在清单 claude_hint，不建矩阵）
- 性能/耗时回归门槛

## Decisions

1. **全部测试容器统一基底 ubuntu:24.04**：前序 SPEC 的集成测试容器与 E2E 容器同源（集成级无 systemd、E2E 级有 systemd），只维护一个镜像族的 Dockerfile。理由：用户已拉取该镜像；减少环境差异导致的测试不对称。
2. **E2E 用特权 systemd 容器而非绕过 systemctl**：内置清单含 `systemctl enable/start` 步骤（clash、ssh），非 systemd 容器会导致清单在测试中被改写（不可接受——清单必须与生产一致）。特权容器是让清单原样执行的最低成本方案。
3. **代理桩断言"走隧道"而非断言"可达海外"**：mock-proxy 记录请求来源，needs_proxy 任务的验证以"请求出现在桩的日志中"为准；真实海外可达性（GitHub 限速等）不作为自动化断言，避免环境抖动。
4. **E2E 串行全量执行 + 失败快照**：单队列按内置清单顺序执行（与真实使用一致）；任一任务失败即收集该任务日志与容器内关键状态（`/etc/apt/sources.list`、`which zsh` 等）到 `tests/e2e/out/` 供排查。
5. **清单转换以逐任务核对为准**：转换产物（命令文本）与 `task.md` 原文逐条对照评审一次后冻结；后续清单演化走正常 SPEC 变更。

## Risks / Trade-offs

- [特权容器在部分 CI 环境不可用] → 手动验收路径兜底（docs/acceptance.md）；本地开发机默认可用
- [ubuntu:24.04 换代 noble 源/包名差异] → 清单 claude_hint 已要求按 VERSION_CODENAME 动态生成源（`install-claude-code` 等）；E2E 恰好回归这一点
- [Docker-in-Docker 类任务（docker apt 源）在容器内安装 dockerd 但不运行守护] → 断言仅验证包安装与版本命令，不在容器内跑容器
- [E2E 总时长（全量 apt/npm 下载）可能 20 分钟+] → 接受；E2E 不进入每次单测循环，按需/夜间触发

## Migration Plan

全新模块。`task.md` 在本 SPEC 验收通过后标记弃用（文件保留至 add-builtin-tasks-e2e 归档）。

## Open Questions

- `assets/clash/config.yaml` 订阅配置需用户提供（现有服务器 `/root/.config/clash/config.yaml` 拷贝）；缺失时清单中 `install-clash` 任务保留但 E2E 中允许该任务标记 skipped（验收文档注明）
