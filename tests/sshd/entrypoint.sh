#!/bin/bash
set -euo pipefail

# Set root password from SSH_PASSWORD env var if provided;
# otherwise generate a random one (logged for test discovery).
if [ -z "${SSH_PASSWORD:-}" ]; then
  SSH_PASSWORD=$(openssl rand -hex 16)
  echo "Generated random SSH password: ${SSH_PASSWORD}"
fi

echo "root:${SSH_PASSWORD}" | chpasswd
export SSH_PASSWORD

exec /usr/sbin/sshd -D -e