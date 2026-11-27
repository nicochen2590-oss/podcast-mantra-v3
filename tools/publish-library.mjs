// 把内容库里的节目元数据写进 Supabase（不含逐字稿）
import fs from "node:fs";
const KEY = (fs.readFileSync(".env.local","utf8").match(/^SUPABASE_SERVICE_KEY=(.+)$/m)||[])[1]?.trim();
const URL = (fs.readFileSync(".env.local","utf8").match(/^SUPABASE_URL=(.+)$/m)||[])[1]?.trim();
if (!KEY || !URL) { console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

const lib = JSON.parse(fs.readFileSync("src/data/featured-library.json","utf8"));
const rows = (lib.episodes||[]).map(e => ({
  id: String(e.url||"").split("/").filter(Boolean).pop(),
  title: e.title, show: e.show, author: e.show,
  cover_url: e.cover_url ?? null, audio_url: e.audio_url ?? null,
  duration_sec: e.duration_sec ?? null, published_at: e.published_at ?? null,
  source_url: e.url, platform: e.platform ?? "xiaoyuzhou",
  theme: e.theme ?? null, subtopic: e.subtopic ?? null,
  content_type: e.content_type ?? null, audience: e.audience ?? null,
})).filter(r => r.id);

for (let i = 0; i < rows.length; i += 50) {
  const batch = rows.slice(i, i + 50);
  const res = await fetch(`${URL}/rest/v1/episodes?on_conflict=id`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(batch),
  });
  console.log(`批次 ${i / 50 + 1}: ${res.status} ${res.ok ? "OK" : await res.text()}`);
}
console.log("完成，共", rows.length, "期");
