#!/bin/bash
# =============================================================================
# server/ssh/fixtures/mock-claude.sh
#
# 可配置行为的 claude mock 脚本 —— 测试用。
#
# 通过环境变量配置行为（修复流程经 exec env 注入到 PTY 进程）：
#   MOCK_CLAUDE_TEXT         启动后输出的文本（缺省一段欢迎语；%b 解析 \n 转义）
#   MOCK_CLAUDE_EXIT_CODE    退出码（缺省 0）
#   MOCK_CLAUDE_DELAY_MS     输出前延时毫秒（模拟异步输出；缺省 0）
#   MOCK_CLAUDE_SLEEP_SEC    输出前睡眠秒数（模拟长会话，便于测试主动终止）
#   MOCK_CLAUDE_ECHO_STDIN   非空时逐行回显 stdin（模拟交互对话）
#   MOCK_CLAUDE_RUN          退出前执行的 shell 命令（模拟"修复"副作用，
#                            如创建标记文件使重跑命令成功）
#   MOCK_CLAUDE_RECORD       记录文件路径：argc/argv 逐项 + prompt（末参）
#
# 输出固定序列后退出；argv/prompt 记录到文件供测试断言。
# =============================================================================
set -uo pipefail

: "${MOCK_CLAUDE_TEXT:=Hello from mock claude}"
: "${MOCK_CLAUDE_EXIT_CODE:=0}"
: "${MOCK_CLAUDE_DELAY_MS:=0}"
: "${MOCK_CLAUDE_SLEEP_SEC:=0}"

# 毫秒级延时（纯 bash 轮询 date +%s%N，无外部依赖）
sleep_ms() {
  local ms=$1 start now
  start=$(date +%s%N)
  while :; do
    now=$(date +%s%N)
    [ $(( (now - start) / 1000000 )) -ge "$ms" ] && break
  done
}

# -- argv / prompt 记录 -----------------------------------------------------
if [ -n "${MOCK_CLAUDE_RECORD:-}" ]; then
  {
    printf 'argc=%s\n' "$#"
    i=0
    for arg in "$@"; do
      printf 'argv[%s]=%s\n' "$i" "$arg"
      i=$((i + 1))
    done
    printf 'prompt=%s\n' "${@: -1}"
  } > "${MOCK_CLAUDE_RECORD}"
fi

# -- 长会话模拟 --------------------------------------------------------------
if [ "${MOCK_CLAUDE_SLEEP_SEC}" -gt 0 ]; then
  sleep "${MOCK_CLAUDE_SLEEP_SEC}"
fi

if [ "${MOCK_CLAUDE_DELAY_MS}" -gt 0 ]; then
  sleep_ms "${MOCK_CLAUDE_DELAY_MS}"
fi

# -- 输出固定序列 ------------------------------------------------------------
printf '%b\n' "${MOCK_CLAUDE_TEXT}"

# -- stdin 回显（交互对话模拟）------------------------------------------------
if [ -n "${MOCK_CLAUDE_ECHO_STDIN:-}" ]; then
  while IFS= read -r line; do
    printf 'ECHO: %s\n' "${line}"
  done
fi

# -- 修复副作用（模拟 claude 对系统的修改，使重跑成功）-------------------------
if [ -n "${MOCK_CLAUDE_RUN:-}" ]; then
  eval "${MOCK_CLAUDE_RUN}"
fi

exit "${MOCK_CLAUDE_EXIT_CODE}"
