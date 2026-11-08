#!/bin/bash
# 启动「自动化专用」浏览器，不占用用户日常 Chrome。
# 可用环境变量覆盖：AGENT_APP / CDP_DATA_DIR / CDP_PROFILE / CDP_PORT
#   AGENT_APP=~/agent-browser/Chrome-Agent.app  （见 04-PUBLISH.md 第二节，自己建一份）
#   CDP_PROFILE=Default                          （登录态所在的 profile 目录名）
set -e
AGENT_APP="${AGENT_APP:-$HOME/agent-browser/Chrome-Agent.app}"
DATA_DIR="${CDP_DATA_DIR:-$HOME/.chrome-cdp-profile}"
PROFILE="${CDP_PROFILE:-Default}"
PORT="${CDP_PORT:-9222}"

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "已在运行: port $PORT"
  exit 0
fi

if [ ! -d "$AGENT_APP" ]; then
  echo "缺少 $AGENT_APP" >&2
  echo "先按 04-PUBLISH.md 第二节复制一份 Chrome 并改 Bundle ID：" >&2
  echo "  cp -R '/Applications/Google Chrome.app' ~/agent-browser/Chrome-Agent.app" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

open -a "$AGENT_APP" --args \
  --user-data-dir="$DATA_DIR" \
  --profile-directory="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --no-first-run --no-default-browser-check

for i in $(seq 1 20); do
  sleep 1
  if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "已启动: port $PORT — 独立于日常 Chrome"
    echo "首次使用请在窗口里手动登录四个平台，登录态会留在 $DATA_DIR"
    exit 0
  fi
done
echo "启动超时" >&2
exit 1
