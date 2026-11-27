// 把云端 episodes.theme 统一成 20 个标准专辑名
import fs from "node:fs";
const env = fs.readFileSync(".env.local", "utf8");
const URL = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
const KEY = (env.match(/^SUPABASE_SERVICE_KEY=(.+)$/m) || [])[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const CANON = [
  "文学与阅读","历史与文明","哲学与思想","艺术与审美","影视与流行文化",
  "社会观察","女性与性别","心理与情绪","自我成长","职业与职场",
  "商业与创业","经济与金融","人工智能","科技与互联网","国际关系与时事",
  "法律与公共制度","医疗与健康","教育与学习","旅行与地理","生活与消费",
];
const MAP = {
  "社会与人文": "社会观察", "科技与互联网": "科技与互联网", "生活与日常": "生活与消费",
  "文化与艺术": "艺术与审美", "教育与学习": "教育与学习", "新闻与国际视野": "国际关系与时事",
  "心理与情绪": "心理与情绪", "健康与运动": "医疗与健康", "商业与经济": "商业与创业",
  "情感与关系": "心理与情绪", "职场与成长": "职业与职场", "个人叙事与陪伴": "社会观察",
  "小众与新兴领域": "社会观察", "悬疑与故事": "影视与流行文化", "科学与自然": "科技与互联网",
  "历史与政治": "历史与文明", "环保低碳": "社会观察", "人文艺术": "艺术与审美",
  "旅游地理": "旅行与地理", "商业财经": "经济与金融", "时政新闻": "国际关系与时事",
  "时事新闻": "国际关系与时事", "学习提升": "教育与学习", "医疗健康": "医疗与健康",
  "自我成长": "自我成长", "人工智能": "人工智能", "旅游": "旅行与地理", "人文": "文学与阅读",
  "商业": "商业与创业",
};

const rows = await (await fetch(`${URL}/rest/v1/episodes?select=id,theme&limit=2000`, { headers: H })).json();
let changed = 0, unknown = 0;
for (const r of rows) {
  const cur = (r.theme || "").trim();
  if (CANON.includes(cur)) continue;
  const next = MAP[cur] || "社会观察";
  if (!MAP[cur]) unknown += 1;
  const res = await fetch(`${URL}/rest/v1/episodes?id=eq.${encodeURIComponent(r.id)}`, {
    method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({ theme: next }),
  });
  if (res.ok) changed += 1;
}
console.log(`云端共 ${rows.length} 期，修正 ${changed} 条，未识别按社会观察归入 ${unknown} 条`);

const after = await (await fetch(`${URL}/rest/v1/episodes?select=theme&limit=2000`, { headers: H })).json();
const c = {};
for (const r of after) c[r.theme || "(未分类)"] = (c[r.theme || "(未分类)"] || 0) + 1;
Object.entries(c).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));
