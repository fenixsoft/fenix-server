# Spec: bundled-assets

## ADDED Requirements

### Requirement: 资源文件就位与引用一致

`assets/` SHALL 包含清单 `files` 引用的全部文件：`zsh_settings/.zshrc`、`zsh_settings/install_ohmyzsh.sh`、`claude_settings/.claude.json`、`claude_settings/settings.json`、`clash/config.yaml`、`fenixserver_key.pub`、`install-claude-code.sh`；引用路径 SHALL 与实际文件一一对应（无悬空引用）。

#### Scenario: 清单 files 无悬空引用

- **WHEN** 汇总清单全部 files 并对照 assets 目录
- **THEN** 每个引用都存在对应文件

#### Scenario: 资源上传后服务器路径正确

- **WHEN** 在集成容器执行含 files 的任务
- **THEN** 文件落在 `/root/server-init/` 对应相对路径且内容一致
