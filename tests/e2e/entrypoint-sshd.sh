#!/bin/bash
# tests/e2e/entrypoint-sshd.sh
#
# 集成级容器 entrypoint：设置 root 密码并前台启动 sshd。
# 与 tests/sshd/entrypoint.sh 语义一致（随机密码注入 + 前台 sshd）。
set -euo pipefail

# 从 SSH_PASSWORD 注入 root 密码；缺省随机生成（打印到日志供测试发现）
if [ -z "${SSH_PASSWORD:-}" ]; then
  SSH_PASSWORD=$(openssl rand -hex 16)
  echo "Generated random SSH password: ${SSH_PASSWORD}"
fi

echo "root:${SSH_PASSWORD}" | chpasswd
export SSH_PASSWORD

exec /usr/sbin/sshd -D -e