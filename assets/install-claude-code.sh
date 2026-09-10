#!/bin/bash
# =============================================================================
# install-claude-code.sh
#
# Claude Code 自动安装配置脚本（task.md §7）。
# 初始内容从用户现有 /root/server-init/ 迁移。
#
# 功能：
#   1. 检查并安装 Node.js（使用 NodeSource 仓库）
#   2. 通过 npm 全局安装 Claude Code (@anthropic-ai/claude-code)
#   3. 复制配置文件：
#        claude_settings/.claude.json → ~/.claude.json
#        claude_settings/settings.json → ~/.claude/settings.json
#
# 执行方式：
#   cd /root/server-init
#   ./install-claude-code.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_BIN="$(command -v claude || true)"

echo "==> [1/3] 检查 Node.js……"

install_node() {
  if [ "$(id -u)" -eq 0 ]; then
    export http_proxy="${http_proxy:-}"
    export https_proxy="${https_proxy:-}"
    # 通过 NodeSource 安装 Node.js LTS
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    echo "错误：未检测到 Node.js，且当前用户非 root，无法自动安装。" >&2
    echo "请先安装 Node.js >= 20 后重试。" >&2
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，开始安装……"
  install_node
else
  NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "Node.js 版本过旧（$(node --version)），需 >= 20，升级中……"
    install_node
  else
    echo "Node.js 已就绪：$(node --version)"
  fi
fi

echo "==> [2/3] 安装 Claude Code……"

# 全局安装 Claude Code（needs_proxy 任务由引擎注入代理环境变量）
npm install -g @anthropic-ai/claude-code

CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  echo "错误：安装后未找到 claude 可执行文件。" >&2
  exit 1
fi
echo "Claude Code 已安装：$(claude --version 2>/dev/null || echo '版本未知')"

echo "==> [3/3] 复制配置文件……"

# .claude.json → ~/.claude.json
if [ -f "$SCRIPT_DIR/claude_settings/.claude.json" ]; then
  cp "$SCRIPT_DIR/claude_settings/.claude.json" "$HOME/.claude.json"
  echo "已复制 ~/.claude.json"
else
  echo "跳过：claude_settings/.claude.json 不存在"
fi

# settings.json → ~/.claude/settings.json
mkdir -p "$HOME/.claude"
if [ -f "$SCRIPT_DIR/claude_settings/settings.json" ]; then
  cp "$SCRIPT_DIR/claude_settings/settings.json" "$HOME/.claude/settings.json"
  echo "已复制 ~/.claude/settings.json"
else
  echo "跳过：claude_settings/settings.json 不存在"
fi

echo "==> Claude Code 安装配置完成。"
exit 0