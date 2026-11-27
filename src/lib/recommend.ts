/**
 * 公共推荐池（只读）与本机收藏（可写）之间的一层。
 *
 * 规矩只有一条：**公共池永远不被写**。用户点「收藏」时，是把这条公共内容
 * 复制一份到本机私人库，从此它的笔记、逐字稿、专辑都只属于这台设备。
 */
import type { Episode } from "@/app/dashboard/types";
import { GUEST_EPISODES } from "@/lib/guest/data";
import { addGuestEpisode, loadGuestLibrary } from "@/lib/guest/store";
import raw from "@/data/recommendations.json";

type RecFile = { items: { url: string; type?: string; topic?: string; reason: string }[] };

export type RecItem = {
  key: string;
  episode: Episode;
  reason: string;
  type: string;
  topic: string;
  theme: string;
};

const FILE = raw as RecFile;

function findEpisodeByUrl(url: string): Episode | null {
  // 先精确匹配，再按"单集标识"兜底（小宇宙是 /episode/<id>，别家可能是 /sound/<id> 或 RSS 直链）
  const exact = GUEST_EPISODES.find((e) => (e.source_url ?? "") === url);
  if (exact) return exact;
  const key = url.split(/\/(?:episode|sound|track)\//)[1]?.split(/[?#]/)[0];
  if (!key) return null;
  return GUEST_EPISODES.find((e) => (e.source_url ?? "").includes(key)) ?? null;
}

/** 与节目单里那一期对上号；对不上的直接丢掉，绝不编造内容 */
export const REC_ITEMS: RecItem[] = (FILE.items ?? [])
  .map((it) => {
    const ep = findEpisodeByUrl(it.url);
    if (!ep) return null;
    return {
      key: ep.id,
      episode: ep,
      reason: it.reason,
      type: it.type ?? "播客",
      topic: it.topic ?? "未分类",
      theme: (it as { theme?: string }).theme ?? it.topic ?? "未分类",
    };
  })
  .filter(Boolean) as RecItem[];

/** 简单稳定的字符串哈希：同一天、同一份榜单，所有访客结果一致 */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 今日精选：日期哈希取模，同一天所有人看到同一条 */
export function dailyPick(items: RecItem[] = REC_ITEMS, date = todayKey()): RecItem | null {
  if (!items.length) return null;
  return items[hash(date) % items.length];
}

/** 主题 → 签文（一个词 + 一句话），让揭晓先给意象、再给内容 */
export const THEME_SLIP: Record<string, { word: string; line: string }> = {
  旅行与远方: { word: "旅行与远方", line: "今天，去认识一个你还没去过的地方。" },
  生活与日常: { word: "生活与日常", line: "今天，把一件小事做得慢一点。" },
  商业与经济: { word: "商业与选择", line: "今天，换个角度看一笔生意怎么做成。" },
  科技与互联网: { word: "科技与未来", line: "今天，看看技术正在悄悄改变什么。" },
  人工智能: { word: "科技与未来", line: "今天，看看技术正在悄悄改变什么。" },
  职场与成长: { word: "职场与成长", line: "今天，想一想你正在成为谁。" },
  自我成长: { word: "自我与变化", line: "今天，听听别人怎么走过一段路。" },
  心理与情绪: { word: "心理与自我", line: "今天，先照顾一下自己的情绪。" },
  情感与关系: { word: "人与人的关系", line: "今天，理解一个你熟悉又陌生的人。" },
  社会与人文: { word: "社会与人间", line: "今天，多一个角度看身边的人。" },
  环保低碳: { word: "环保与低碳", line: "今天，想想我们和这个星球的关系。" },
  历史与政治: { word: "历史与来路", line: "今天，往回看一段决定现在的事。" },
  文化与艺术: { word: "文化与审美", line: "今天，让一件作品陪你待一会儿。" },
  教育与学习: { word: "学习与好奇心", line: "今天，学一件看起来没用的事。" },
  健康与运动: { word: "身体与健康", line: "今天，听听身体在说什么。" },
  娱乐与兴趣: { word: "娱乐与流行", line: "今天，聊点轻松但有意思的。" },
  新闻与国际视野: { word: "世界与此刻", line: "今天，看看世界正在发生什么。" },
  科学与自然: { word: "科学与自然", line: "今天，重新认识一个熟悉的自然现象。" },
  悬疑与故事: { word: "故事与谜案", line: "今天，听一个让人背后发凉的故事。" },
  个人叙事与陪伴: { word: "人与人的故事", line: "今天，听一个普通人的一生片段。" },
  小众与新兴领域: { word: "小众与探索", line: "今天，去一个你从没涉足的角落。" },
  时事新闻: { word: "世界与此刻", line: "今天，看看世界正在发生什么。" },
};

export function slipOf(theme: string): { word: string; line: string } {
  return THEME_SLIP[theme] ?? { word: theme || "今日一签", line: "今天，听一条平时不会点开的。" };
}

/** 当天的抽签记录：初次由日期决定，主动重抽才变，刷新保持 */
const DAILY_KEY = "pm_daily_draw_v2";
export type DailyDraw = { date: string; key: string; count: number };

export function loadDailyDraw(): DailyDraw | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY) || "null") as DailyDraw | null;
    if (!raw || raw.date !== todayKey() || !findRecByKey(raw.key)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveDailyDraw(d: DailyDraw) {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch { /* 忽略 */ }
}

export type DrawMode = "random" | "topic" | "time";
export type TimeBucket = "under5" | "5to15" | "15to30" | "over30";

export const TOPICS = [...new Set(REC_ITEMS.map((r) => r.topic))];

export const TIME_BUCKETS: { key: TimeBucket; label: string; test: (sec: number) => boolean }[] = [
  { key: "under5", label: "5 分钟以内", test: (s) => s > 0 && s < 300 },
  { key: "5to15", label: "5–15 分钟", test: (s) => s >= 300 && s < 900 },
  { key: "15to30", label: "15–30 分钟", test: (s) => s >= 900 && s < 1800 },
  { key: "over30", label: "30 分钟以上", test: (s) => s >= 1800 },
];

/** 抽签：mode + 条件 → 从公共池里挑一条，尽量避开上一次 */
export function drawOne(opts: {
  mode: DrawMode;
  topic?: string | null;
  bucket?: TimeBucket | null;
  avoidKey?: string | null;
  items?: RecItem[];
}): RecItem | null {
  const pool = opts.items ?? REC_ITEMS;
  let list = pool;
  if (opts.mode === "topic" && opts.topic) list = list.filter((r) => r.topic === opts.topic);
  if (opts.mode === "time" && opts.bucket) {
    const rule = TIME_BUCKETS.find((b) => b.key === opts.bucket);
    list = list.filter((r) => rule?.test(r.episode.duration_sec ?? 0));
  }
  if (!list.length) return null;
  let candidates = list;
  if (opts.avoidKey && list.length > 1) candidates = list.filter((r) => r.key !== opts.avoidKey);
  if (!candidates.length) candidates = list;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------- 当天抽签结果（刷新不变） ----------

const TODAY_KEY = "pm_draw_today_v1";

export type DrawRecord = { date: string; mode: DrawMode; key: string; topic?: string | null; bucket?: TimeBucket | null };

export function loadTodayDraw(): DrawRecord | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TODAY_KEY) || "null") as DrawRecord | null;
    if (!raw || raw.date !== todayKey()) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveTodayDraw(rec: DrawRecord) {
  try { localStorage.setItem(TODAY_KEY, JSON.stringify(rec)); } catch { /* 存不下只影响今天 */ }
}

export function findRecByKey(key: string): RecItem | null {
  return REC_ITEMS.find((r) => r.key === key) ?? null;
}

// ---------- 收藏到私人库 ----------

/** 是否已经在私人库里（按原链接判断，避免重复收藏） */
export function isSaved(item: RecItem): boolean {
  const url = item.episode.source_url ?? "";
  if (!url) return false;
  return loadGuestLibrary().episodes.some((e) => (e.source_url ?? "") === url);
}

/**
 * 收藏推荐内容：复制一份进私人库，带上推荐理由，之后跟普通收藏完全一样。
 * 返回 true 表示这次真的存进去了，false 表示本来就有。
 */
export function saveToLibrary(item: RecItem): boolean {
  if (isSaved(item)) return false;
  const now = new Date().toISOString();
  const ep: Episode = {
    ...item.episode,
    id: `guest-local-rec-${Date.now()}`,
    created_at: now,
    added_at: now,
    transcript_status: "pending",
    note: `推荐理由：${item.reason}`,
  };
  addGuestEpisode(ep);
  return true;
}
