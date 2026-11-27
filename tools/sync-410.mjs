// 把导出的 410 期（含逐字稿）上传到 Supabase，专辑名写到 episodes.theme
import fs from "node:fs";
const SRC = process.argv[2];
if (!SRC) { console.error("用法: node tools/sync-410.mjs <导出.json>"); process.exit(1); }

const env = fs.readFileSync(".env.local", "utf8");
const URL = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1]?.trim();
const KEY = (env.match(/^SUPABASE_SERVICE_KEY=(.+)$/m) || [])[1]?.trim();
if (!URL || !KEY) { console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

const dump = JSON.parse(fs.readFileSync(SRC, "utf8"));
const albumMap = JSON.parse(fs.readFileSync("src/data/album-mapping.json", "utf8")).episodes;

const H = {
  apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

async function upsert(table, rows) {
  let ok = 0;
  for (let i = 0; i < rows.length; i += 40) {
    const batch = rows.slice(i, i + 40);
    const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=` + (table === "transcripts" ? "episode_id" : "id"), {
      method: "POST", headers: H, body: JSON.stringify(batch),
    });
    if (!res.ok) { console.error(`  ${table} 批次失败 ${res.status}`, (await res.text()).slice(0, 160)); }
    else ok += batch.length;
  }
  return ok;
}

const episodes = dump.episodes.map((e) => ({
  id: e.id,
  title: e.title,
  show: e.author ?? null,
  author: e.author ?? null,
  cover_url: e.cover_url ?? null,
  audio_url: e.audio_url ?? null,
  duration_sec: e.duration_sec ?? null,
  published_at: e.published_at ?? null,
  source_url: e.source_url ?? null,
  platform: e.platform ?? "xiaoyuzhou",
  theme: albumMap[e.id] ?? null,
}));

console.log(`上传 ${episodes.length} 期节目…`);
console.log("  episodes 成功", await upsert("episodes", episodes));

const tx = Object.entries(dump.transcripts ?? {}).map(([eid, t]) => ({
  episode_id: eid,
  segments: t.segments ?? null,
  edited: t.edited_transcript ?? null,
  article: t.article ?? null,
  mindmap: t.mindmap ?? null,
  insights: t.insights ?? null,
  chapters: t.chapters ?? null,
  llm: !!t.llm,
  quality_note: t.quality_note ?? null,
  status: "done",
  updated_at: new Date().toISOString(),
}));
console.log(`上传 ${tx.length} 份逐字稿…`);
console.log("  transcripts 成功", await upsert("transcripts", tx));
