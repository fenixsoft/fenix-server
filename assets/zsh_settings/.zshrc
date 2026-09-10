# zsh_settings/.zshrc
#
# 预配置的 ZSH 配置文件（从用户现有 /root/server-init/ 迁移）。
# 配置内容（task.md §3.5）：
#   - 主题 ys
#   - 插件 extract / zsh-autosuggestions / zsh-syntax-highlighting
#   - OpenSpec 补全配置
#   - fzf 快捷键绑定（Ctrl+T 文件搜索，Ctrl+R 历史搜索）
#   - Claude 函数 cc() 自动添加权限跳过参数
#   - 禁用自动更新

# 启用 Oh My Zsh（由 install-ohmyzsh 任务提供框架）
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="ys"

# 插件
plugins=(extract zsh-autosuggestions zsh-syntax-highlighting)

# fzf 着色方案（安装 fzf 后生效）
export FZF_DEFAULT_OPTS='--height 40% --layout=reverse --border'

# Oh My Zsh 初始化
source "$ZSH/oh-my-zsh.sh"

# OpenSpec 补全：为 openspec / osm 命令启用 shell 补全（若已安装）
if command -v openspec >/dev/null 2>&1; then
  eval "$(openspec completion zsh 2>/dev/null || true)"
fi

# fzf 快捷键绑定：Ctrl+T 文件搜索，Ctrl+R 历史搜索（fzf 包提供 __fzf_zsh_bindings）
if [ -f /usr/share/doc/fzf/examples/key-bindings.zsh ]; then
  source /usr/share/doc/fzf/examples/key-bindings.zsh
fi

# Claude 函数 cc()：自动添加权限跳过参数
cc() {
  claude --dangerously-skip-permissions "$@"
}

# 禁用自动更新
DISABLE_AUTO_UPDATE="true"
export DISABLE_AUTO_UPDATE

# 自定义别名
alias ls='ls --color=auto'
alias ll='ls -lah'
alias clr='clear'