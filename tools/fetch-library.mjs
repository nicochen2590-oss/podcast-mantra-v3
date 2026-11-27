/**
 * 批量生成「真实播客清单」src/data/featured-library.json
 *
 * 用法：
 *   1) 把链接写进 data/my-links.txt，一行一个（可在后面加 ` | 专辑名`）
 *   2) node tools/fetch-library.mjs
 *   3) 可选：--dry-run 只打印不写入；--merge 与现有清单合并去重
 *
 * 支持：
 *   - 小宇宙单集页  xiaoyuzhoufm.com/episode/<eid>
 *   - 小宇宙节目页  xiaoyuzhoufm.com/podcast/<pid>  → 自动展开成多期
 *   - Apple Podcasts  podcasts.apple.com / itunes.apple.com → 官方 lookup API
 *   - B 站           bilibili.com/video/BV... / b23.tv 短链 → 公开 view API
 *   - 抖音 / 小红书  尝试读页面 og 元数据，抓不到就留空位让你补
 *   - 任意链接       读 <title> / og:image 兜底
 *
 * 只抓公开元数据，不下载音频/视频/逐字稿，逐条限速 400ms，保留原链接与署名。
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const LINKS_FILE = path.join(ROOT, "data", "my-links.txt");
const OUT_FILE = path.join(ROOT, "src", "data", "featured-library.json");
const DRY = process.argv.includes("--dry-run");
const MERGE = process.argv.includes("--merge");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, asJson = false) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return asJson ? res.json() : res.text();
}
function meta(html, key) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"));
  return m ? m[1] : null;
}
function clean(s) {
  return String(s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&/g, "&").replace(/\s+/g, " ").trim();
}
function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/* ---------------- 小宇宙 ---------------- */
async function xyzEpisode(eid, topic) {
  const url = `https://www.xiaoyuzhoufm.com/episode/${eid}`;
  const html = await get(url);
  const d = nextData(html);
  const ep = d?.props?.pageProps?.episode;
  if (!ep) throw new Error("未读到单集信息");
  const pod = ep.podcast ?? null;
  return {
    title: clean(ep.title || meta(html, "og:title") || "未命名单集"),
    show: clean(pod?.title || ""),
    platform: "xiaoyuzhou",
    url,
    cover_url: ep.image?.picUrl ?? ep.image?.thumbnailUrl ?? pod?.image?.picUrl ?? meta(html, "og:image") ?? null,
    duration_sec: typeof ep.duration === "number" ? Math.round(ep.duration) : null,
    published_at: (ep.pubDate ?? "").slice(0, 10) || null,
    topic,
    blurb: "",
  };
}
async function xyzPodcast(pid, topic) {
  const html = await get(`https://www.xiaoyuzhoufm.com/podcast/${pid}`);
  const eids = [...new Set((html.match(/\/episode\/[a-zA-Z0-9]{20,}/g) || []).map((s) => s.replace("/episode/", "")))];
  const out = [];
  for (const eid of eids.slice(0, 40)) {
    try { out.push(await xyzEpisode(eid, topic)); } catch (e) { console.warn("  ! 跳过", eid, e.message); }
    await sleep(400);
  }
  return out;
}

/* ---------------- Apple Podcasts（官方 lookup，免密钥） ---------------- */
async function apple(url, topic) {
  const episodeId = new URL(url).searchParams.get("i");
  const idMatch = url.match(/\/id(\d+)/);
  const lookupId = episodeId || idMatch?.[1];
  if (!lookupId) throw new Error("链接里没找到 podcast/episode id");
  const j = await get(`https://itunes.apple.com/lookup?id=${lookupId}&entity=podcastEpisode&limit=60`, true);
  const rows = (j.results ?? []).filter((r) => r.wrapperType === "podcastEpisode");
  if (!rows.length) {
    const one = (j.results ?? []).find((r) => r.wrapperType === "podcast");
    if (!one) throw new Error("lookup 没有结果");
    return [{ title: clean(one.collectionName), show: clean(one.artistName), platform: "other", url, cover_url: one.artworkUrl600 ?? null, duration_sec: null, published_at: (one.releaseDate ?? "").slice(0, 10) || null, topic, blurb: "" }];
  }
  return rows.map((r) => ({
    title: clean(r.trackName || r.collectionName),
    show: clean(r.artistName || r.collectionName),
    platform: "other",
    url: r.trackViewUrl || url,
    cover_url: r.artworkUrl600 ?? r.artworkUrl160 ?? null,
    duration_sec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
    published_at: (r.releaseDate ?? "").slice(0, 10) || null,
    topic, blurb: "",
  }));
}

/* ---------------- B 站 ---------------- */
async function bilibili(url, topic) {
  const finalUrl = await get(url).then(() => url).catch(() => url);
  const bv = finalUrl.match(/(BV[a-zA-Z0-9]+)/)?.[1] || url.match(/(BV[a-zA-Z0-9]+)/)?.[1];
  if (!bv) throw new Error("没找到 BV 号");
  const j = await get(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, true);
  if (j.code !== 0 || !j.data) throw new Error(`B站接口返回 ${j.code}: ${j.message}`);
  const d = j.data;
  return [{
    title: clean(d.title), show: clean(d.owner?.name || "B站UP主"), platform: "bilibili",
    url: `https://www.bilibili.com/video/${bv}`,
    cover_url: d.pic ?? null,
    duration_sec: typeof d.duration === "number" ? d.duration : null,
    published_at: d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 10) : null,
    topic, blurb: "",
  }];
}

/* ---------------- 抖音 / 小红书 / 其它：og 元数据兜底 ---------------- */
async function generic(url, platform, topic) {
  const html = await get(url);
  const title = clean(meta(html, "og:title") || meta(html, "twitter:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  return [{
    title: title || "（待补标题）",
    show: clean(meta(html, "og:site_name") || meta(html, "author") || platform),
    platform,
    url,
    cover_url: meta(html, "og:image") || null,
    duration_sec: null, published_at: null, topic, blurb: "",
  }];
}

function detect(url) {
  if (/xiaoyuzhoufm\.com\/podcast\//i.test(url)) return { type: "xyzPodcast", platform: "xiaoyuzhou" };
  if (/xiaoyuzhoufm\.com\/episodes?\//i.test(url)) return { type: "xyzEpisode", platform: "xiaoyuzhou" };
  if (/podcasts\.apple\.com|itunes\.apple\.com/i.test(url)) return { type: "apple", platform: "other" };
  if (/bilibili\.com|b23\.tv/i.test(url)) return { type: "bilibili", platform: "bilibili" };
  if (/douyin\.com|v\.douyin/i.test(url)) return { type: "generic", platform: "douyin" };
  if (/xiaohongshu\.com|xhslink/i.test(url)) return { type: "generic", platform: "xiaohongshu" };
  return { type: "generic", platform: "other" };
}

async function handle(line) {
  const [rawUrl, topic = ""] = line.split("|").map((s) => s.trim());
  const url = rawUrl;
  const { type, platform } = detect(url);
  if (type === "xyzPodcast") return xyzPodcast(url.match(/\/podcast\/([a-zA-Z0-9]+)/)[1], topic);
  if (type === "xyzEpisode") return [await xyzEpisode(url.match(/\/episodes?\/([a-zA-Z0-9]+)/)[1], topic)];
  if (type === "apple") return apple(url, topic);
  if (type === "bilibili") return bilibili(url, topic);
  return generic(url, platform, topic);
}

async function main() {
  let text = "";
  try { text = await fs.readFile(LINKS_FILE, "utf8"); }
  catch { console.error(`请先把链接写进 ${LINKS_FILE}（一行一个，可加 | 专辑名）`); process.exit(1); }

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const all = [];
  for (const line of lines) {
    const url = line.split("|")[0].trim();
    console.log("→", url);
    try {
      const items = await handle(line);
      items.forEach((it) => { if (it.title) all.push(it); });
      console.log("   ✓", items.length, "期");
    } catch (e) {
      console.warn("   ✗", e.message, "→ 写成待补条目");
      all.push({ title: "（待补标题）", show: "", platform: detect(url).platform, url, cover_url: null, duration_sec: null, published_at: null, topic: line.split("|")[1]?.trim() ?? "", blurb: "" });
    }
    await sleep(400);
  }

  // 按 url 去重
  const seen = new Set();
  let episodes = all.filter((e) => { if (seen.has(e.url)) return false; seen.add(e.url); return true; });

  if (MERGE) {
    try {
      const old = JSON.parse(await fs.readFile(OUT_FILE, "utf8"));
      const oldUrls = new Set((old.episodes ?? []).map((e) => e.url));
      episodes = [...(old.episodes ?? []), ...episodes.filter((e) => !oldUrls.has(e.url))];
    } catch { /* 没有旧文件就忽略 */ }
  }

  const out = {
    "_说明": "真实播客清单（元数据索引）。请勿放入未授权的逐字稿全文或音频文件；播放一律链回原平台。",
    topics: [],
    episodes,
  };
  console.log(`\n共 ${episodes.length} 期${DRY ? "（--dry-run，未写入）" : ` → ${OUT_FILE}`}`);
  if (DRY) console.log(JSON.stringify(episodes.slice(0, 3), null, 2));
  else await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
}
main().catch((e) => { console.error(e); process.exit(1); });
