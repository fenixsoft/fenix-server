#!/bin/bash
# =============================================================================
# zsh_settings/install_ohmyzsh.sh
#
# Oh My Zsh 安装脚本（本地副本，无需 curl 外网下载）。
# 取自用户现有 /root/server-init/ 同路径文件。
#
# 用法：
#   sh install_ohmyzsh.sh [--unattended]
#
# 兼容 oh-my-zsh 官方 install.sh 的常用环境变量：
#   REPO       - 要克隆的仓库（默认 fenixsoft/ohmyzsh，国内镜像）
#   BRANCH     - 分支（默认 master）
#   REMOTE     - 远端名（默认 origin）
#   ZSH        - 安装目录（默认 ~/.oh-my-zsh）
#
# 行为：
#   - 已存在 ~/.oh-my-zsh → 跳过克隆（除非 ZSH_FORCE_REINSTALL=1）
#   - --unattended → 不询问切换到 zsh 的确认
# =============================================================================
set -e

# 兼容官方脚本的仓库/镜像配置
REPO="${REPO:-fenixsoft/ohmyzsh}"
BRANCH="${BRANCH:-master}"
REMOTE="${REMOTE:-origin}"
ZSH="${ZSH:-$HOME/.oh-my-zsh}"

UNATTENDED=0
for arg in "$@"; do
  case "$arg" in
    --unattended) UNATTENDED=1 ;;
  esac
done

if [ -d "$ZSH/.git" ]; then
  if [ "${ZSH_FORCE_REINSTALL:-0}" = "1" ]; then
    echo "~/.oh-my-zsh 已存在，ZSH_FORCE_REINSTALL=1，强制重装。"
    rm -rf "$ZSH"
  else
    echo "~/.oh-my-zsh 已存在，跳过克隆。"
    exit 0
  fi
fi

echo "开始安装 Oh My Zsh（REPO=$REPO）……"
if command -v git >/dev/null 2>&1; then
  git clone --depth=1 --branch "$BRANCH" "https://github.com/$REPO.git" "$ZSH"
else
  echo "错误：未找到 git，无法克隆 Oh My Zsh。" >&2
  exit 1
fi

# 生成默认 .zshrc 模板（若用户已存在则保留）
if [ ! -f "$HOME/.zshrc" ] || [ "$ZSH_FORCE_REINSTALL" = "1" ]; then
  if [ -f "$ZSH/templates/zshrc.zsh-template" ]; then
    cp "$ZSH/templates/zshrc.zsh-template" "$HOME/.zshrc"
    echo "已生成默认 ~/.zshrc 模板（后续 config-zshrc 任务会用预配置版本覆盖）。"
  fi
fi

echo "Oh My Zsh 安装完成。"
if [ "$UNATTENDED" = "0" ]; then
  echo "提示：重启 shell 或执行 'exec zsh' 使配置生效。"
fi

exit 0