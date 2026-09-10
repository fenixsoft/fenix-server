# Proposal: add-builtin-tasks-e2e

## Why

前五个 SPEC 构成了工具的全部机械能力（连接、执行、隧道、修复、界面），但工具的最终交付物是"一份正确的内置初始化清单 + 一次真实服务器上的全流程通过"。本 SPEC 产出内置任务清单与资源文件，并建立以 `ubuntu:24.04` Docker 容器为基准的实际初始化端到端验证——每次清单或引擎变更都可回归。

## What Changes

- 新增 `assets/tasks.yaml`：内置默认任务清单——由现行 `task.md` 转换（APT 阿里源、基础工具、Git 配置、Python、ZSH 全套、Clash、Docker、gh、Playwright、Superpowers、OpenSpec、SSHD 配置、Claude Code 安装等约 15 项）；要点：`install-claude-code` 排最前（满足"先装 Claude Code，失败可回退"）、全部海外网络任务标 `needs_proxy: true`（不依赖服务器 Clash 顺序）、`requires` 依赖图完整、关键任务带 `verify` 与 `claude_hint`
- 新增 `assets/` 资源文件：`zsh_settings/.zshrc`、`zsh_settings/install_ohmyzsh.sh`、`claude_settings/.claude.json`、`claude_settings/settings.json`、`clash/config.yaml`、`fenixserver_key.pub`、`install-claude-code.sh`（初始内容从用户现有 `/root/server-init/` 迁移；`clash/config.yaml` 订阅配置由用户提供）
- 新增端到端验证设施：`tests/e2e/`（ubuntu:24.04 容器编排 + 全量清单执行 + 逐任务断言）与代理桩（本地 mock 代理，验证 needs_proxy 任务真实走隧道出网）
- 新增手动验收清单文档 `docs/acceptance.md`：对真实 Ubuntu 服务器的验收步骤

## Capabilities

### New Capabilities

- `builtin-task-manifest`: 内置任务清单——task.md 到 YAML 的完整转换、依赖图与代理标注、清单可通过 schema 校验
- `bundled-assets`: 随工具分发的资源文件——清单 `files` 引用的全部资源就位且上传后路径/内容正确
- `e2e-verification`: 端到端验证——基于 ubuntu:24.04 容器（systemd 模式）的实际初始化执行与逐任务断言、代理桩链路验证、手动验收清单

### Modified Capabilities

（无）

## Impact

- 新增文件：`assets/**`、`tests/e2e/**`、`docs/acceptance.md`
- 依赖全部前序 SPEC（这是收官 SPEC）
- 用户已拉取 `ubuntu:24.04` 镜像作为验证基准
