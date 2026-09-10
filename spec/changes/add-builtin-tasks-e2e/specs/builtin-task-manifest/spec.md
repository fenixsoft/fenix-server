# Spec: builtin-task-manifest

## ADDED Requirements

### Requirement: 内置清单内容完整转换

`assets/tasks.yaml` SHALL 完整覆盖现行 `task.md` 的全部操作步骤（约 15 个任务：APT 阿里源、常用工具、Git 配置、Python 环境、ZSH、Oh My Zsh、ZSH 插件、FZF、ZSHRC 配置、Clash、Docker、gh、Playwright、Superpowers、OpenSpec、SSHD 配置、Claude Code 安装），命令文本与原文一致或语义等价；`install-claude-code` SHALL 为依赖图根任务之一且无前置（最先可执行）。

#### Scenario: 清单通过 schema 校验

- **WHEN** 用 shared schema 校验 `assets/tasks.yaml`
- **THEN** 校验通过，任务数与预期一致且 id 无重复

#### Scenario: Claude Code 安装任务无前置

- **WHEN** 检查 `install-claude-code` 的 `requires`
- **THEN** 为空（依赖图根任务，最先可执行）

#### Scenario: 与 task.md 步骤对照无遗漏

- **WHEN** 逐节对照 task.md 与清单任务
- **THEN** 原文每个含执行命令的小节都有对应任务，无遗漏小节

### Requirement: 代理标注与依赖图

全部需要海外网络的任务（Docker、gh、Playwright、Superpowers、OpenSpec、ZSH 插件、Clash 下载、Claude Code 安装）SHALL 标记 `needs_proxy: true`；无网络依赖任务（APT 源、基础工具、SSHD 配置）SHALL 不标记；`requires` SHALL 构成有效 DAG（如 `config-zshrc` 依赖 ohmyzsh/插件/fzf；`install-zsh-plugins` 依赖 ohmyzsh）。

#### Scenario: 海外任务全部标注代理

- **WHEN** 检查各任务 needs_proxy 标注
- **THEN** 海外网络任务均为 true，其余为 false

#### Scenario: 依赖图无环且关键顺序正确

- **WHEN** 对全清单做环检测与拓扑排序
- **THEN** 无环；install-claude-code、apt-aliyun-mirror 位于队列前部；config-zshrc 位于 zsh 系任务之后

### Requirement: 关键任务验证与修复提示

关键任务 SHALL 提供 `verify` 命令（如 zsh/git/docker/gh/openspec 的 `--version`、sshd 的配置 grep、阿里源的 apt update 输出检查）；易失败任务 SHALL 提供 `claude_hint`（如按 VERSION_CODENAME 调整源代号、ZSH 插件目录约定）。

#### Scenario: 关键任务带验证命令

- **WHEN** 检查 install-zsh、install-docker、install-gh-cli、install-openspec、config-sshd
- **THEN** 均含 verify 命令且命令客观可判定（退出码语义明确）
