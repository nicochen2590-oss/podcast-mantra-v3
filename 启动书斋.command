#!/bin/zsh
# 双击这个文件就能启动 Podcast Mantra（不用敲命令）。
# 打开的终端窗口别关：关掉就等于关掉网站。

cd "$(dirname "$0")" || exit 1
PORT=3000

# 找一个能用的 node：优先系统 PATH，其次 WorkBuddy 自带的
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "$HOME"/.workbuddy/binaries/node/versions/*/bin/node 2>/dev/null | tail -1)"
fi
if [ -z "$NODE" ]; then
  echo "没找到 node，先跟我说一声，我来装。"
  read -r "?按回车关闭…"
  exit 1
fi

if lsof -ti tcp:$PORT >/dev/null 2>&1; then
  echo "书斋已经在 $PORT 端口跑着了，直接给你打开浏览器。"
  open "http://localhost:$PORT"
  exit 0
fi

echo "正在启动书斋…（第一次打开会慢几秒）"
( sleep 7; open "http://localhost:$PORT" ) &
exec "$NODE" node_modules/next/dist/bin/next dev -p "$PORT"
