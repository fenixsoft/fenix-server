# 服务器初始化清单模板

> 本模板用于记录服务器初始化的所有操作步骤，供 Claude Code 自动执行。

---

## 基础信息

- **服务器类型**: Ubuntu (最新版本)
- **操作系统**: Ubuntu
- **初始化日期**: 2026-05-05
- **执行者**: Claude Code

---

## 操作步骤

### 1. 系统基础配置

#### 1.1 设置阿里云APT源

**操作说明**: 将默认Ubuntu官方源替换为阿里云镜像源，加速软件包下载。

**执行命令**:

```bash
# 1. 备份原有源配置
cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 2. 写入阿里云源配置 (根据实际Ubuntu版本调整，如 jammy/noble)
# Ubuntu 22.04 (Jammy) 示例:
cat > /etc/apt/sources.list << 'EOF'
deb http://mirrors.aliyun.com/ubuntu/ jammy main restricted
deb http://mirrors.aliyun.com/ubuntu/ jammy-updates main restricted
deb http://mirrors.aliyun.com/ubuntu/ jammy universe
deb http://mirrors.aliyun.com/ubuntu/ jammy-updates universe
deb http://mirrors.aliyun.com/ubuntu/ jammy multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-updates multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-backports main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ jammy-security main restricted
deb http://mirrors.aliyun.com/ubuntu/ jammy-security universe
deb http://mirrors.aliyun.com/ubuntu/ jammy-security multiverse
EOF

# 3. 更新软件包缓存
apt update
```

**验证方法**: 执行 `apt update` 无报错，且显示从 `mirrors.aliyun.com` 获取软件包。

---

### 2. 基础工具安装（无网络依赖）

#### 2.1 安装常用工具

**操作说明**: 安装基础开发运维工具包。

**执行命令**:

```bash
apt install -y zip unzip zlib1g-dev net-tools git
```

**包说明**:
| 包名 | 用途 |
|------|------|
| zip | 压缩工具 |
| unzip | 解压工具 |
| zlib1g-dev | zlib开发库 |
| net-tools | 网络工具(ifconfig等) |
| git | 版本控制 |

**验证方法**: 各命令可执行，如 `git --version`、`zip -v`。

#### 2.2 配置Git用户信息

**操作说明**: 设置Git全局用户名和邮箱。

**执行命令**:

```bash
git config --global user.name 'icyfenix'
git config --global user.email 'icyfenix@gamil.com'
```

**验证方法**: 执行 `git config --global --list` 查看配置。

#### 2.3 安装Python3开发环境

**操作说明**: 安装Python3及相关开发工具。

**执行命令**:

```bash
apt install -y python3 python3-pip python3-venv
```

**安装内容**:
| 包名 | 说明 |
|------|------|
| python3 | Python 3.12.3 |
| python3-pip | pip包管理器 |
| python3-venv | 虚拟环境支持 |
| build-essential | 编译工具链（依赖自动安装） |

**验证方法**: `python3 --version` 查看版本。

---

### 3. Shell环境配置

#### 3.1 安装ZSH并设置为默认Shell

**操作说明**: 安装Zsh shell并将其设置为root用户的默认shell。

**执行命令**:

```bash
# 1. 安装ZSH
apt install -y zsh

# 2. 设置为默认shell
chsh -s $(which zsh) root
```

**验证方法**: 执行 `getent passwd root | cut -d: -f7` 确认shell路径为 `/usr/bin/zsh`。

#### 3.2 安装Oh My Zsh

**操作说明**: 安装Oh My Zsh框架，使用本地安装脚本（无需网络依赖）。

**执行命令**:

```bash
# 使用本地安装脚本
REPO=fenixsoft/ohmyzsh sh /root/server-init/zsh_settings/install_ohmyzsh.sh --unattended
```

**脚本位置**: `/root/server-init/zsh_settings/install_ohmyzsh.sh`

**验证方法**: 执行 `zsh` 进入shell，显示Oh My Zsh界面。

#### 3.3 安装ZSH插件

**操作说明**: 安装zsh-autosuggestions和zsh-syntax-highlighting插件。

**依赖条件**: 需要Git代理配置（见4.1节）

**执行命令**:

```bash
# 安装zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-autosuggestions ~/.oh-my-zsh/custom/plugins/zsh-autosuggestions

# 安装zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ~/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting
```

**插件功能**:
- `zsh-autosuggestions`: 命令自动建议（灰色提示历史命令）
- `zsh-syntax-highlighting`: 命令语法高亮

#### 3.4 安装FZF

**操作说明**: 安装fzf命令行模糊搜索工具（.zshrc中引用）。

**执行命令**:

```bash
apt install -y fzf
```

**工具功能**:
- 命令行模糊搜索
- 文件/目录搜索
- 历史命令搜索
- 与zsh/bash集成

**验证方法**: `fzf --version` 查看版本。

#### 3.5 配置ZSHRC

**操作说明**: 复制预配置的.zshrc文件。

**执行命令**:

```bash
# 复制zshrc配置文件（如有预配置文件）
cp /root/server-init/zsh_settings/.zshrc ~/.zshrc
```

**配置文件位置**: `/root/server-init/zsh_settings/.zshrc`

**配置内容说明**:
- 主题: `ys`
- 插件: `extract`, `zsh-autosuggestions`, `zsh-syntax-highlighting`
- OpenSpec补全配置
- fzf快捷键绑定（Ctrl+T文件搜索，Ctrl+R历史搜索）
- Claude函数 `cc()` 自动添加权限跳过参数
- 禁用自动更新

**验证方法**: `zsh` 进入shell后检查主题和插件是否生效。

---

### 4. 网络代理配置（关键前置）

> **重要**: 以下步骤需要代理才能访问GitHub等海外资源，必须先完成Clash安装。

#### 4.1 安装Clash代理服务

**操作说明**: 安装Mihomo(Clash Meta)代理工具，配置SS协议订阅，设置开机启动并开放代理端口。

**执行命令**:

```bash
# 1. 下载Mihomo (通过代理下载GitHub资源)
export http_proxy=http://127.0.0.1:20122
export https_proxy=http://127.0.0.1:20122
wget -O /tmp/clash.gz https://github.com/MetaCubeX/mihomo/releases/download/v1.18.10/mihomo-linux-amd64-v1.18.10.gz
unset http_proxy https_proxy

# 2. 安装
mkdir -p /opt/clash
gunzip -c /tmp/clash.gz > /opt/clash/clash
chmod +x /opt/clash/clash
ln -sf /opt/clash/clash /usr/local/bin/clash

# 3. 创建systemd服务
cat > /etc/systemd/system/clash.service << 'EOF'
[Unit]
Description=Clash Proxy Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/clash -d /root/.config/clash
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

# 4. 配置订阅
mkdir -p ~/.config/clash
# 配置文件写入 ~/.config/clash/config.yaml
# mixed-port: 20122 (代理端口)

# 5. 启动服务并设置开机启动
systemctl daemon-reload
systemctl enable clash
systemctl start clash

# 6. 为git配置代理（不影响其他程序）
git config --global http.proxy http://127.0.0.1:20122
git config --global https.proxy http://127.0.0.1:20122
```

**订阅信息**:
- 订阅URL: `https://times1775836390.subtangniu.top:9606/v2b/catnet/api/v1/client/subscribe?token=d1d5f627fd1928aea31ba06e790470ec`
- 协议: Shadowsocks (SS)
- 加密: aes-128-gcm
- 代理端口: 20122 (mixed HTTP/SOCKS)
- 控制面板: http://127.0.0.1:9090
- 节点: 香港、日本、新加坡、美国、台湾、德国等多地区专线（共48个节点）

**验证方法**: 
- `systemctl status clash` 查看服务状态
- `git config --global --list | grep proxy` 查看git代理配置

---

### 5. 需要代理的软件安装

> **前置条件**: 已完成4.1节Clash代理安装

#### 5.1 安装Docker

**操作说明**: 安装Docker容器引擎及相关组件。

**执行命令**:

```bash
# 1. 通过代理下载Docker GPG密钥
curl -fsSL -x http://127.0.0.1:20122 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# 2. 添加Docker APT源
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update

# 3. 安装Docker组件
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**安装内容**:
| 组件 | 说明 |
|------|------|
| docker-ce | Docker引擎 |
| docker-ce-cli | Docker命令行工具 |
| containerd.io | 容器运行时 |
| docker-buildx-plugin | 构建扩展插件 |
| docker-compose-plugin | Docker Compose插件 |

**验证方法**: `docker --version` 查看版本。

#### 5.2 安装GitHub CLI (gh)

**操作说明**: 安装GitHub官方命令行工具。

**执行命令**:

```bash
# 1. 添加GitHub CLI仓库 (通过代理)
export http_proxy=http://127.0.0.1:20122
export https_proxy=http://127.0.0.1:20122
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null

# 2. 安装
apt update && apt install gh -y
unset http_proxy https_proxy
```

**验证方法**: `gh --version` 查看版本。

#### 5.3 安装Playwright CLI和Headless Chrome

**操作说明**: 安装Playwright浏览器自动化工具、Chrome浏览器和playwright-cli skill。

**执行命令**:

```bash
# 1. 全局安装Playwright CLI（测试框架）
npm install -g playwright

# 2. 全局安装@playwright/cli（浏览器自动化CLI工具）
npm install -g @playwright/cli@latest

# 3. 创建playwright-cli配置目录和文件
mkdir -p /etc/playwright
echo '{}' > /etc/playwright/cli.config.json

# 4. 安装Chrome浏览器（playwright-cli需要标准Chrome，不是Chromium）
# 注意：需要代理才能下载
export HTTP_PROXY=http://127.0.0.1:20122
export HTTPS_PROXY=http://127.0.0.1:20122
playwright-cli install-browser chrome

# 5. 安装Chromium浏览器（用于Playwright测试框架）
playwright install chromium

# 6. 安装浏览器运行依赖（字体、图形库等）
playwright install-deps chromium

# 7. 安装playwright-cli skill (通过代理)
mkdir -p ~/.claude/skills/playwright-cli
curl -fsSL https://raw.githubusercontent.com/microsoft/playwright-cli/main/skills/playwright-cli/SKILL.md -o ~/.claude/skills/playwright-cli/SKILL.md
```

**安装内容**:
| 组件 | 说明 |
|------|------|
| playwright | Playwright测试框架 (v1.59.1) |
| @playwright/cli | 浏览器自动化CLI工具 (v0.1.11) |
| Google Chrome | playwright-cli使用的浏览器 (v147+) |
| Chromium | Playwright测试框架浏览器 |
| Chromium Headless Shell | 无头浏览器shell |
| FFmpeg | 视频处理工具 |
| 系统依赖 | 字体、图形库、X11等 |
| playwright-cli skill | Claude Code浏览器自动化技能 |

**验证方法**: 
- `playwright --version` 查看测试框架版本
- `playwright-cli --version` 查看CLI版本
- `google-chrome --version` 查看Chrome版本
- `ls ~/.cache/ms-playwright/` 查看浏览器缓存
- `ls ~/.claude/skills/playwright-cli/` 查看skill安装
- `playwright-cli open https://example.com` 测试浏览器打开

#### 5.4 安装Claude Code Superpowers插件

**操作说明**: 安装Superpowers - Claude Code核心技能库，包含TDD、调试、协作模式等。

**执行命令**:

```bash
export http_proxy=http://127.0.0.1:20122
export https_proxy=http://127.0.0.1:20122

# 1. 添加superpowers-marketplace
mkdir -p ~/.claude/plugins/marketplaces/superpowers-marketplace
curl -fsSL https://raw.githubusercontent.com/obra/superpowers-marketplace/main/.claude-plugin/marketplace.json -o ~/.claude/plugins/marketplaces/superpowers-marketplace/marketplace.json

# 2. 克隆superpowers插件
mkdir -p ~/.claude/plugins/installed/superpowers
git clone --depth 1 https://github.com/obra/superpowers.git ~/.claude/plugins/installed/superpowers

unset http_proxy https_proxy

# 3. 配置known_marketplaces.json
cat > ~/.claude/plugins/known_marketplaces.json << 'EOF'
{
  "claude-plugins-official": {
    "source": {"source": "github", "repo": "anthropics/claude-plugins-official"},
    "installLocation": "/root/.claude/plugins/marketplaces/claude-plugins-official",
    "lastUpdated": "2026-05-05T01:53:09.741Z"
  },
  "superpowers-marketplace": {
    "source": {"source": "github", "repo": "obra/superpowers-marketplace"},
    "installLocation": "/root/.claude/plugins/marketplaces/superpowers-marketplace",
    "lastUpdated": "2026-05-05T02:26:00.000Z"
  }
}
EOF

# 4. 配置installed_plugins.json（包含cacheLocation）
cat > ~/.claude/plugins/installed_plugins.json << 'EOF'
{
  "version": 2,
  "plugins": {
    "superpowers@superpowers-marketplace": {
      "source": {"source": "url", "url": "https://github.com/obra/superpowers.git"},
      "installLocation": "/root/.claude/plugins/installed/superpowers",
      "cacheLocation": "/root/.claude/plugins/cache/superpowers-marketplace/superpowers/5.1.0",
      "version": "5.1.0",
      "installedAt": "2026-05-05T02:26:00.000Z",
      "strict": true
    }
  }
}
EOF

# 5. 创建缓存目录并同步内容
mkdir -p ~/.claude/plugins/cache/superpowers-marketplace/superpowers/5.1.0
cp -r ~/.claude/plugins/installed/superpowers/* ~/.claude/plugins/cache/superpowers-marketplace/superpowers/5.1.0/

# 6. 启用插件（更新settings.json中的enabledPlugins）
# 将 "superpowers@superpowers-marketplace": true 添加到enabledPlugins
```

**插件功能**:
- 20+实战技能
- `/brainstorm`, `/write-plan`, `/execute-plan`命令
- TDD、调试、协作模式
- SessionStart上下文注入

**验证方法**: 检查 `~/.claude/plugins/installed/superpowers/` 目录存在。

#### 5.5 安装OpenSpec

**操作说明**: 安装OpenSpec - AI原生规格驱动开发系统。

**执行命令**:

```bash
npm install -g @fission-ai/openspec
```

**工具功能**:
- 规格驱动开发管理
- 变更提案管理
- 交互式仪表板
- 工作流验证

**验证方法**: `openspec --version` 查看版本。

---

### 6. 服务配置

#### 6.1 配置SSH服务器

**操作说明**: 配置SSH服务器允许root用户登录、密码认证和公钥认证。

**执行命令**:

```bash
# 1. 创建.ssh目录并设置权限
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# 2. 将公钥添加到authorized_keys（如有公钥文件）
cat /root/server-init/fenixserver_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 3. 配置sshd_config
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# 4. 重启SSH服务
systemctl restart ssh
systemctl enable ssh
```

**关键配置项说明**:
| 配置项 | 值 | 说明 |
|--------|----|------|
| PermitRootLogin | yes | 允许root用户SSH登录 |
| PasswordAuthentication | yes | 允许密码方式认证 |
| PubkeyAuthentication | yes | 允许公钥方式认证 |

**配置文件位置**:
- SSH配置: `/etc/ssh/sshd_config`
- 公钥文件: `/root/server-init/fenixserver_key.pub`（如需要）
- 授权文件: `/root/.ssh/authorized_keys`

**验证方法**: 
- `systemctl status ssh` 查看服务状态
- `grep -E "PermitRootLogin|PasswordAuthentication|PubkeyAuthentication" /etc/ssh/sshd_config` 查看配置

---

### 7. Claude Code安装脚本

**操作说明**: 创建Claude Code自动安装配置脚本，用于在新机器上快速部署。

**脚本位置**: `/root/server-init/install-claude-code.sh`

**脚本功能**:
1. 检查并安装Node.js（使用NodeSource仓库）
2. 通过npm全局安装Claude Code (`@anthropic/claude-code`)
3. 复制配置文件：
   - `.claude.json` → `~/.claude.json`
   - `settings.json` → `~/.claude/settings.json`

**执行方式**:

```bash
# 在新机器上执行
cd /root/server-init
./install-claude-code.sh
```

**配置文件说明**:
| 文件 | 作用 |
|------|------|
| `.claude.json` | Claude Code全局配置（API密钥、模型等） |
| `settings.json` | Claude Code设置（权限、插件等） |

**配置目录**: `/root/server-init/claude_settings/`

---

### 8. 安全设置

<!-- 记录安全相关设置 -->

---

### 9. 其他配置

<!-- 记录其他配置项 -->

---

## 验证检查

- [ ] 1. 系统基础配置验证
- [ ] 2. 基础工具安装验证
- [ ] 3. Shell环境配置验证
- [ ] 4. 网络代理配置验证
- [ ] 5. 需代理软件安装验证
- [ ] 6. 服务配置验证
- [ ] 7. Claude Code脚本验证

---

## 备注

### 执行顺序说明

本清单按照依赖关系排序，执行时请按章节顺序进行：

1. **第1-2章**: 无外部网络依赖，可直接执行
2. **第3章**: Shell环境配置（依赖部分git clone，可在代理配置后补充）
3. **第4章**: 关键前置 - Clash代理必须先安装
4. **第5章**: 需要代理访问GitHub等海外资源，必须在第4章完成后执行
5. **第6章**: 服务配置
6. **第7章**: Claude Code安装脚本

### 关键依赖关系

| 任务 | 前置依赖 |
|------|----------|
| Docker安装 | Clash代理（GPG密钥下载） |
| Superpowers插件 | Clash代理（GitHub访问） |
| ZSH插件安装 | Git代理配置 |

---

## 文件清单

| 文件/目录 | 作用 |
|-----------|------|
| `task.md` | 初始化任务清单 |
| `install-claude-code.sh` | Claude Code安装脚本 |
| `claude_settings/.claude.json` | Claude全局配置 |
| `claude_settings/settings.json` | Claude设置文件 |
| `zsh_settings/.zshrc` | ZSH配置文件 |
| `zsh_settings/install_ohmyzsh.sh` | Oh My Zsh安装脚本 |
| `fenixserver_key.pub` | SSH公钥文件 |