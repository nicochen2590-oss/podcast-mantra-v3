/**
 * 给公共索引补两样东西：音频直链 + 节目（show）封面。
 *
 * 为什么要补：站内播放需要 audio_url；卡片要按「节目」显示封面，
 * 而不是每一集各自的花絮图。这两样都在小宇宙单集页的 __NEXT_DATA__ 里。
 *
 * 用法：
 *   node tools/enrich-library.mjs          # 补齐缺失的字段（已有则跳过）
 *   node tools/enrich-library.mjs --force  # 全部重抓
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "src", "data", "featured-library.json");
const FORCE = process.argv.includes("--force");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrape(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.xiaoyuzhoufm.com/" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("没有 __NEXT_DATA__");
  const data = JSON.parse(m[1]);
  const ep = data?.props?.pageProps?.episode;
  if (!ep) throw new Error("没有 episode");
  return {
    audio_url: ep.enclosure?.url ?? null,
    show_cover_url:
      ep.podcast?.image?.picUrl ?? ep.podcast?.image?.thumbnailUrl ?? null,
    show_id: ep.podcast?.pid ?? null,
  };
}

const raw = JSON.parse(await readFile(FILE, "utf8"));
const episodes = raw.episodes ?? [];
let done = 0;
let skipped = 0;
const failed = [];

for (const ep of episodes) {
  if (!ep.url) { skipped++; continue; }
  if (!FORCE && ep.audio_url && ep.show_cover_url) { skipped++; continue; }
  try {
    const got = await scrape(ep.url);
    Object.assign(ep, {
      audio_url: got.audio_url ?? ep.audio_url ?? null,
      show_cover_url: got.show_cover_url ?? ep.show_cover_url ?? null,
      show_id: got.show_id ?? ep.show_id ?? null,
    });
    done++;
    process.stdout.write(`✓ ${ep.show ?? ""} ${String(ep.title).slice(0, 22)}\n`);
  } catch (e) {
    failed.push({ url: ep.url, why: e.message });
    process.stdout.write(`✗ ${String(ep.title).slice(0, 22)} — ${e.message}\n`);
  }
  await sleep(450); // 别把小宇宙打疼
}

await writeFile(FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
console.log(`\n补齐 ${done} 条，跳过 ${skipped} 条，失败 ${failed.length} 条`);
if (failed.length) console.log(failed);
