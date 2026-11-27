// 按标题/简介给节目归类；--apply 才写回文件
import fs from "node:fs";
const apply = process.argv.includes("--apply");
const LIB = "src/data/featured-library.json";
const RULES = [
  ["商业与经济", ["商业", "公司", "营收", "利润", "品牌", "市场", "创业", "融资", "财报", "消费", "零售", "定价", "生意", "企业", "收购", "上市"]],
  ["新闻与国际视野", ["新闻", "速览", "今日", "政策", "国际", "选举", "制裁", "时政", "世界", "全球", "报道"]],
  ["人工智能", ["AI", "人工智能", "大模型", "算法", "芯片", "机器人", "算力", "智能体", "GPT"]],
  ["科技与互联网", ["科技", "互联网", "产品", "平台", "数据", "软件", "硬件", "App", "手机", "电脑"]],
  ["健康与运动", ["健康", "医疗", "医生", "疾病", "药", "睡眠", "运动", "跑步", "健身", "心理", "情绪", "抑郁", "焦虑"]],
  ["教育与学习", ["学习", "教育", "读书", "考试", "老师", "课程", "大学", "学校", "孩子", "留学"]],
  ["旅游", ["旅行", "旅游", "目的地", "签证", "城市", "国家", "环球", "游记", "南美", "欧洲", "日本"]],
  ["英语学习", ["英语", "English", "口语", "听力", "雅思", "单词", "外刊"]],
  ["文化与艺术", ["文化", "艺术", "电影", "音乐", "文学", "展览", "戏剧", "摄影", "小说", "诗", "书", "导演"]],
  ["社会与人文", ["社会", "城市", "劳动", "群体", "调查", "现象", "年轻人", "女性", "家庭", "历史", "人文"]],
  ["心理与情绪", ["心理", "情绪", "自我", "成长", "习惯", "选择", "关系", "人生", "疗愈", "孤独"]],
];
const lib = JSON.parse(fs.readFileSync(LIB, "utf8"));
let changed = 0;
const stats = {};
for (const e of lib.episodes ?? []) {
  const hay = `${e.title} ${e.blurb ?? ""}`;
  let best = { score: 0, theme: "" };
  for (const [theme, words] of RULES) {
    const s = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    if (s > best.score) best = { score: s, theme };
  }
  const cur = (e.theme ?? "").trim();
  const empty = !cur || cur === "待归类" || cur === "未分类" || cur === "其他";
  if (!empty) { stats[cur] = (stats[cur] ?? 0) + 1; continue; } // 已有分类不动
  const target = best.score >= 1 ? best.theme : "社会与人文";
  if (target !== cur) { changed++; e.theme = target; }
  stats[target] = (stats[target] ?? 0) + 1;
}
console.log(`共 ${lib.episodes.length} 期，需调整 ${changed} 期`);
Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(String(n).padStart(3), t));
if (apply) { fs.writeFileSync(LIB, JSON.stringify(lib, null, 1) + "\n"); console.log("已写回"); }
else console.log("（预演模式，加 --apply 才会写回）");
