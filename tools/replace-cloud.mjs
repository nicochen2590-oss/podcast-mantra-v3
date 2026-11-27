// 用最新导出替换云端数据：upsert 新集合，删除已不在集合里的旧本地期，避免重复
import fs from "node:fs";
const SRC = process.argv[2];
const env = fs.readFileSync(".env.local", "utf8");
const URL = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
const KEY = (env.match(/^SUPABASE_SERVICE_KEY=(.+)$/m) || [])[1].trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const PREF = { ...H, Prefer: "resolution=merge-duplicates,return=minimal" };

const dump = JSON.parse(fs.readFileSync(SRC, "utf8"));
const albumMap = JSON.parse(fs.readFileSync("src/data/album-mapping.json", "utf8")).episodes;
const ids = new Set(dump.episodes.map((e) => e.id));

const episodes = dump.episodes.map((e) => ({
  id: e.id, title: e.title, show: e.author ?? null, author: e.author ?? null,
  cover_url: e.cover_url ?? null, audio_url: e.audio_url ?? null,
  duration_sec: e.duration_sec ?? null, published_at: e.published_at ?? null,
  source_url: e.source_url ?? null, platform: e.platform ?? "xiaoyuzhou",
  theme: albumMap[e.id] ?? e.theme ?? null,
}));

let up = 0;
for (let i = 0; i < episodes.length; i += 40) {
  const batch = episodes.slice(i, i + 40);
  const r = await fetch(`${URL}/rest/v1/episodes?on_conflict=id`, { method: "POST", headers: PREF, body: JSON.stringify(batch) });
  if (r.ok) up += batch.length; else console.log("批次失败", r.status, (await r.text()).slice(0, 120));
}
console.log(`episodes 上传 ${up}/${episodes.length}`);

const tx = Object.entries(dump.transcripts ?? {}).map(([eid, t]) => ({
  episode_id: eid, segments: t.segments ?? null, edited: t.edited_transcript ?? null,
  article: t.article ?? null, mindmap: t.mindmap ?? null, insights: t.insights ?? null,
  chapters: t.chapters ?? null, llm: !!t.llm, quality_note: t.quality_note ?? null,
  status: "done", updated_at: new Date().toISOString(),
}));
let tup = 0;
for (let i = 0; i < tx.length; i += 20) {
  const batch = tx.slice(i, i + 20);
  const r = await fetch(`${URL}/rest/v1/transcripts?on_conflict=episode_id`, { method: "POST", headers: PREF, body: JSON.stringify(batch) });
  if (r.ok) tup += batch.length; else console.log("逐字稿批次失败", r.status, (await r.text()).slice(0, 120));
}
console.log(`transcripts 上传 ${tup}/${tx.length}`);

// 删掉云端已不在本次集合里的 guest-local-* 期（旧的、删过的）
const all = await (await fetch(`${URL}/rest/v1/episodes?select=id&limit=2000`, { headers: H })).json();
const stale = all.map((r) => r.id).filter((id) => id.startsWith("guest-local-") && !ids.has(id));
console.log(`需要清掉的旧本地期 ${stale.length} 条`);
let del = 0;
for (let i = 0; i < stale.length; i += 30) {
  const batch = stale.slice(i, i + 30);
  const q = batch.map((x) => `"${x}"`).join(",");
  const r = await fetch(`${URL}/rest/v1/transcripts?episode_id=in.(${encodeURIComponent(q)})`, { method: "DELETE", headers: H });
  if (r.ok) del += batch.length;
  await fetch(`${URL}/rest/v1/episodes?id=in.(${encodeURIComponent(q)})`, { method: "DELETE", headers: H });
}
console.log(`已清理 ${del} 条`);
