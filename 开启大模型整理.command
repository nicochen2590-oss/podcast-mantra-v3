#!/bin/zsh
# 双击运行：把 DeepSeek 的 API Key 写进 .env.local，之后「重新整理」就会走大模型。
cd "$(dirname "$0")" || exit 1
ENV=".env.local"

echo ""
echo "  开启大模型整理（可选）"
echo "  ────────────────────────────────"
echo "  1. 打开 https://platform.deepseek.com/ → 注册 → 充值（先充 10 元就够很久）"
echo "  2. API Keys → 创建 → 复制那串 sk- 开头的字符串"
echo ""
echo "  把 key 粘贴到这里，回车（直接回车 = 取消）："
printf "  Key: "
read -r KEY
KEY="$(echo "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then
  echo "  已取消，什么都没改。"
  read -r "?  按回车关闭…"
  exit 0
fi
if [[ "$KEY" != sk-* ]]; then
  echo "  这看起来不像 DeepSeek 的 key（应以 sk- 开头）。已取消。"
  read -r "?  按回车关闭…"
  exit 1
fi

python3 - "$ENV" "$KEY" <<'PY'
import sys, re
path, key = sys.argv[1], sys.argv[2]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except FileNotFoundError:
    lines = []
out, done = [], False
for line in lines:
    if re.match(r"^\s*DEEPSEEK_API_KEY\s*=", line):
        out.append(f"DEEPSEEK_API_KEY={key}"); done = True
    else:
        out.append(line)
if not done:
    out += ["", "# 大模型整理（可选）", f"DEEPSEEK_API_KEY={key}"]
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
print("  已写入 .env.local")
PY

# 让本地识别服务立刻读到新 key（它会自己重读 .env.local，无需重启）
curl -s --max-time 3 http://127.0.0.1:8765/health >/dev/null 2>&1 || {
  echo "  本地识别服务没在跑，先打开网页用一次自动转写，它会自己起来。"
}
sleep 1
LLM=$(curl -s --max-time 3 http://127.0.0.1:8765/health | python3 -c "import sys,json;print(json.load(sys.stdin).get('llm'))" 2>/dev/null)
if [ "$LLM" = "True" ]; then
  echo "  ✅ 已生效：回到网页，打开一期 → 概览 → 点「重新整理」。"
else
  echo "  已写入，但服务还没读到（可能没在跑）。打开网页用一次自动转写即可。"
fi
echo ""
read -r "?  按回车关闭…"
