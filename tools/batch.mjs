#!/usr/bin/env node
/**
 * 批量转写 + 自动整理（离线跑，适合放一晚上）
 *
 *   node tools/batch.mjs            # 处理所有还没转写的
 *   node tools/batch.mjs --limit 3  # 只跑 3 期（试跑用）
 *   node tools/batch.mjs --id xxx   # 只跑某一期
 *
 * 结果写到 data/transcripts/<id>.json，网页会通过 /api/transcript 读到。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LIB = path.join(ROOT, "src/data/featured-library.json");
const OUT = path.join(ROOT, "data/transcripts");
const WEB = process.env.PM_WEB ?? "http://127.0.0.1:3000";
const CHUNK = 60;

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const onlyId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 上传到 Supabase 用的密钥（读 .env.local，不写死在代码里）
function readPublishKey() {
  if (process.env.PM_PUBLISH_KEY) return process.env.PM_PUBLISH_KEY;
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    return (env.match(/^PM_PUBLISH_KEY=(.+)$/m) || [])[1]?.trim() ?? "";
  } catch { return ""; }
}
const PUBLISH_KEY = readPublishKey();

// ---- Supabase（读申请队列 + 读节目信息 + 标记完成）----
function readEnv(key) {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    return (env.match(new RegExp(`^${key}=(.+)$`, "m")) || [])[1]?.trim() ?? "";
  } catch { return ""; }
}
const SB_URL = readEnv("SUPABASE_URL");
const SB_KEY = readEnv("SUPABASE_SERVICE_KEY");
const SB_HEAD = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sbGet(q) {
  const r = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: SB_HEAD });
  return r.ok ? r.json() : [];
}
async function sbMarkDone(id) {
  await fetch(`${SB_URL}/rest/v1/transcribe_requests?episode_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...SB_HEAD, Prefer: "return=minimal" },
    body: JSON.stringify({ status: "done", updated_at: new Date().toISOString() }),
  });
}
const log = (...a) => console.log(new Date().toLocaleTimeString("zh-CN"), ...a);

const lib = JSON.parse(fs.readFileSync(LIB, "utf8"));
const all = lib.episodes ?? [];
fs.mkdirSync(OUT, { recursive: true });

const outFile = (id) => path.join(OUT, `${id.replace(/[^\w.-]/g, "_")}.json`);
const force = args.includes("--force");
const done = (id) => (force ? false : fs.existsSync(outFile(id)));

// 库里的期不一定有 id 字段，用链接最后一段当 id
const idOf = (e) => e.id ?? String(e.url ?? "").split("/").filter(Boolean).pop() ?? "";
// --requests：优先处理访客在页面上「申请转写」的期（云端队列）
const wantsRequests = args.includes("--requests");
let queue = [];

if (wantsRequests && SB_URL && SB_KEY) {
  const pending = await sbGet("transcribe_requests?select=episode_id,count&status=eq.pending&order=count.desc&limit=50");
  log(`云端待处理申请 ${pending.length} 条`);
  for (const req of pending) {
    const rows = await sbGet(`episodes?select=id,title,show,author,cover_url,audio_url,duration_sec,published_at,source_url,platform,theme&id=eq.${encodeURIComponent(req.episode_id)}&limit=1`);
    const row = rows[0];
    if (!row?.audio_url) { log(`跳过 ${req.episode_id}（云端没有音频直链）`); continue; }
    queue.push({
      id: row.id, title: row.title, show: row.show, author: row.author,
      cover_url: row.cover_url, audio_url: row.audio_url, duration_sec: row.duration_sec,
      published_at: row.published_at, url: row.source_url, platform: row.platform,
      theme: row.theme,
    });
  }
} else {
  queue = all
    .filter((e) => e.audio_url && (onlyId ? idOf(e) === onlyId : true))
    .filter((e) => !done(idOf(e)))
    .slice(0, limit === Infinity ? undefined : limit);
}

log(`待处理 ${queue.length} 期 / 全库 ${all.length} 期`);
if (!queue.length) process.exit(0);

async function transcribe(ep) {
  let cursor = 0;
  let total = ep.duration_sec || 0;
  const segs = [];
  for (let guard = 0; guard < 400; guard++) {
    const r = await fetch(`${WEB}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: ep.audio_url, title: ep.title, cursor_sec: cursor, total_sec: total }),
    }).then((x) => x.json());

    if (r.status === "error") throw new Error(r.message || "转写失败");
    if (r.total_sec) total = r.total_sec;
    if (r.segments?.length) {
      const seen = new Set(segs.map((s) => s.start_ms));
      segs.push(...r.segments.filter((s) => !seen.has(s.start_ms)));
    }
    if (r.status === "done" || !r.segments?.length) break;
    cursor += CHUNK;
    if (cursor > total) break;
  }
  if (!segs.length) throw new Error("没有拿到逐字稿");
  return segs.sort((a, b) => a.start_ms - b.start_ms);
}

async function analyze(ep, segs) {
  await fetch(`${WEB}/api/analyze-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      episode_id: idOf(ep),
      title: ep.title,
      segments: segs.map((s) => ({ start_ms: s.start_ms, text: s.text })),
    }),
  });
  for (let i = 0; i < 540; i++) { // 最多等 45 分钟
    await sleep(5000);
    const j = await fetch(`${WEB}/api/analyze-job?episode_id=${encodeURIComponent(ep.id)}`).then((x) => x.json());
    if (j.status === "done") return j.result;
    if (j.status === "error") throw new Error(j.error || "整理失败");
  }
  throw new Error("整理超时");
}

let ok = 0;
let fail = 0;
for (const [i, ep] of queue.entries()) {
  const tag = `[${i + 1}/${queue.length}]`;
  try {
    log(`${tag} 转写：${ep.title.slice(0, 30)}`);
    const segs = await transcribe(ep);
    log(`${tag} 逐字稿 ${segs.length} 段，开始整理…`);
    const result = await analyze(ep, segs);

    fs.writeFileSync(outFile(idOf(ep)), JSON.stringify({
      episode: {
        id: idOf(ep), title: ep.title, show: ep.show, author: ep.show,
        platform: ep.platform, source_url: ep.url, cover_url: ep.cover_url,
        audio_url: ep.audio_url, duration_sec: ep.duration_sec,
        published_at: ep.published_at, theme: ep.theme, subtopic: ep.subtopic,
        content_type: ep.content_type, audience: ep.audience,
      },
      transcript: {
        segments: segs,
        edited_transcript: result?.edited_transcript ?? null,
        article: result?.article ?? null,
        chapters: result?.chapters ?? [],
        overview: result?.overview ?? null,
        takeaways: result?.takeaways ?? [],
        quotes: result?.quotes ?? [],
        actions: result?.actions ?? [],
        examples: result?.examples ?? [],
        questions: result?.questions ?? [],
        keywords: result?.keywords ?? null,
        insights: result?.insights ?? null,
        mindmap: result?.mindmap ?? null,
        llm: !!result?.llm,
        quality_note: result?.quality_note ?? null,
      },
    }, null, 1));
    // 自动上传到 Supabase（线上网站读的就是这一份）
    if (PUBLISH_KEY) {
      try {
        const payload = JSON.parse(fs.readFileSync(outFile(idOf(ep)), "utf8"));
        const r = await fetch(`${WEB}/api/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-publish-key": PUBLISH_KEY },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        log(`${tag} ↑ 已上传云端`);
      } catch (e) {
        log(`${tag} ⚠ 上传失败（本地已保存，可稍后重跑）：${e instanceof Error ? e.message : e}`);
      }
    } else {
      log(`${tag} ⚠ 没有找到 PM_PUBLISH_KEY，跳过上传`);
    }
    if (wantsRequests) await sbMarkDone(idOf(ep));
    ok++;
    log(`${tag} ✓ 完成（文章 ${(result?.article?.sections ?? []).length} 节 · 观点 ${(result?.takeaways ?? []).length} · 金句 ${(result?.quotes ?? []).length} · 知识点 ${(result?.insights ?? []).length}）`);
  } catch (e) {
    fail++;
    log(`${tag} ✗ 失败：${e instanceof Error ? e.message : e}`);
  }
  await sleep(1000);
}
log(`全部结束：成功 ${ok} 期，失败 ${fail} 期`);
