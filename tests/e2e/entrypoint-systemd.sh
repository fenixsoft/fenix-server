#!/bin/bash
# tests/e2e/entrypoint-systemd.sh
#
# E2E 级容器 entrypoint：注入 root 密码（SSH_PASSWORD）后 exec systemd。
# PID1 为 systemd（exec 替换自身进程，PID 不变），密码在 init 前生效。
# 与 Dockerfile.sshd 的 entrypoint-sshd.sh 保持同一"密码运行时注入"策略。
set -euo pipefail

# 从 SSH_PASSWORD 注入 root 密码（缺省 e2epass123）
SSH_PASSWORD="${SSH_PASSWORD:-e2epass123}"
echo "root:${SSH_PASSWORD}" | chpasswd

exec /sbin/init