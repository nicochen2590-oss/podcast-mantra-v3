#!/bin/bash
# Podcast Mantra 排版编辑器 · 双击启动
cd "$(dirname "$0")" || exit 1
EDITOR_PAGE="design-studio.html"
PORT=8899

echo "============================================"
echo "  Podcast Mantra 排版编辑器"
echo "============================================"
echo "正在启动本地服务..."
echo

# 优先用 python3 起服务（Mac 自带）
if command -v python3 >/dev/null 2>&1; then
  # 检查端口是否被占用
  if ! lsof -ti:$PORT >/dev/null 2>&1; then
    python3 -m http.server $PORT >/dev/null 2>&1 &
    sleep 1.5
  fi
  URL="http://localhost:$PORT/$EDITOR_PAGE"
  echo "✅ 服务已启动"
  echo "正在用默认浏览器打开：$URL"
  open "$URL" 2>/dev/null || echo "请手动在浏览器打开：$URL"
else
  # 没有 python3 就直接打开文件（localStorage 仍可用）
  echo "未检测到 python3，将直接用浏览器打开文件。"
  open "$EDITOR_PAGE"
fi

echo
echo "============================================"
echo "  使用提示"
echo "============================================"
echo "· 关闭编辑器：直接关掉浏览器标签即可"
echo "· 数据自动保存在浏览器本地，无需手动保存"
echo "· 换电脑/清理浏览器数据前，记得点右上角「导出」备份"
echo "· 此窗口可以关闭（服务会随窗口关闭而停止）"
echo
echo "按回车键关闭此窗口..."
read -r
