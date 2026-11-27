/**
 * 「示范书斋」加载器：打开就能看到的内容，全部来自**真实播客清单**。
 *
 * 数据来源：src/data/featured-library.json（由用户提供，助手填充）。
 * 这里不生成任何虚构节目、不编造逐字稿、不引用未授权封面。
 * 清单为空时，页面会显示「空位书」引导态，而不是空白页。
 *
 * 为什么内置：页面不再依赖登录态与云端；清单本身就是内容，
 * 用户的改动（余音、专辑、逐字稿）叠加在本机草稿层上。
 *
 * 版权边界：只收录元数据（标题/节目/时长/平台/原链接/封面缩略）与用户
 * 自己写的短评；不收录逐字稿全文与音频文件，播放一律链回原平台。
 */
import type { Episode, Topic, TranscriptSegment } from "@/app/dashboard/types";
import raw from "@/data/featured-library.json";
import demoTranscript from "@/data/demo-transcript.json";

type FeaturedEpisode = {
  title: string;
  show?: string | null;
  platform?: string | null;
  url?: string | null;
  cover_url?: string | null;
  /** 节目封面（由 tools/enrich-library.mjs 从单集页抓来的 show.image） */
  show_cover_url?: string | null;
  show_id?: string | null;
  /** 音频直链（同上，站内播放用） */
  audio_url?: string | null;
  duration_sec?: number | null;
  published_at?: string | null;
  topic?: string | null;
  blurb?: string | null;
  quote?: string | null;
  note?: string | null;
  rating?: number | null;
};
type FeaturedTopic = { id?: string; name: string; color?: string | null };
type FeaturedFile = { topics?: FeaturedTopic[]; episodes?: FeaturedEpisode[] };

const FILE = raw as FeaturedFile;

/** 清单为空时使用的默认专辑（与登录态的预置专辑同名，分类口径一致） */
const DEFAULT_TOPICS: Topic[] = [
  { id: "guest-t-01", name: "人间闲谈", color: "#9a8bc4" },
  { id: "guest-t-02", name: "远方与路", color: "#6f8fa8" },
  { id: "guest-t-03", name: "商业洞察", color: "#b98a86" },
  { id: "guest-t-04", name: "品牌出海", color: "#c07f62" },
  { id: "guest-t-05", name: "消费观察", color: "#c0a06a" },
  { id: "guest-t-06", name: "字里行间", color: "#a97b93" },
  { id: "guest-t-07", name: "心事与人", color: "#8aa387" },
  { id: "guest-t-08", name: "科技与新知", color: "#6f94a8" },
  { id: "guest-t-09", name: "声色与审美", color: "#b0873e" },
  { id: "guest-t-10", name: "拾光杂记", color: "#8d8b96" },
];

export const GUEST_TOPICS: Topic[] =
  FILE.topics && FILE.topics.length
    ? FILE.topics.map((t, i) => ({
        id: t.id || `guest-t-${String(i + 1).padStart(2, "0")}`,
        name: t.name,
        color: t.color ?? DEFAULT_TOPICS[i % DEFAULT_TOPICS.length].color,
      }))
    : DEFAULT_TOPICS;

export const PLATFORM_LABEL: Record<string, string> = {
  xiaoyuzhou: "小宇宙", bilibili: "B站", douyin: "抖音", xiaohongshu: "小红书", other: "链接",
};
const VALID_PLATFORMS = ["xiaoyuzhou", "bilibili", "douyin", "xiaohongshu", "other"] as const;
function normPlatform(v: string | null | undefined): Episode["platform"] {
  return (VALID_PLATFORMS as readonly string[]).includes(v ?? "") ? (v as Episode["platform"]) : "other";
}

const SOURCE_URL: Record<string, string> = {};

export type GuestCard = {
  seed: number;
  show: string;
  showColor: string;
  title: string;
  subject: string;
  platform: Episode["platform"];
  no: string;
  topicId: string;
  topicName: string;
  url: string | null;
};

const PALETTE = ["#9a8bc4", "#6f8fa8", "#b98a86", "#c07f62", "#c0a06a", "#a97b93", "#8aa387", "#6f94a8", "#b0873e", "#8d8b96"];

const CARDS: GuestCard[] = (FILE.episodes ?? []).map((r, i) => {
  const topic = GUEST_TOPICS.find((t) => t.name === r.topic) ?? GUEST_TOPICS[GUEST_TOPICS.length - 1];
  return {
    seed: i,
    show: r.show?.trim() || "未注明节目",
    showColor: PALETTE[i % PALETTE.length],
    title: r.title,
    subject: r.title,
    platform: normPlatform(r.platform),
    no: `No. ${String(i + 1).padStart(3, "0")}`,
    topicId: topic.id,
    topicName: topic.name,
    url: r.url?.trim() || null,
  };
});

/** 公共索引统一记为「清单生成那天收进来的」 */
const SEED_ADDED_AT = "2026-11-24T10:00:00.000Z";

const REAL_EPISODES: Episode[] = (FILE.episodes ?? []).map((r, i) => {
  const c = CARDS[i];
  // published_at 是节目发布的时间；added_at 才是「它进到你书斋」的时间。
  // 这 55 期是随公共索引一起到的，统一记在清单生成那天（2026-11-24），
  // 这样「月度书架」按收录月份归档，而不是被发布月份带跑。
  const published = r.published_at?.trim() || null;
  const added = SEED_ADDED_AT;
  return {
    id: `guest-e-${String(i + 1).padStart(3, "0")}`,
    title: r.title,
    episode_no: c.no,
    cover_url: r.cover_url?.trim() || null,
    show_cover_url: r.show_cover_url?.trim() || null,
    show_id: r.show_id?.trim() || null,
    audio_url: r.audio_url?.trim() || null,
    source_url: r.url?.trim() || null,
    platform: c.platform,
    duration_sec: r.duration_sec ?? null,
    published_at: published,
    transcript_status: "ready",
    created_at: added,
    added_at: added,
    topic_id: c.topicId,
    author: c.show,
    summary: r.blurb?.trim() || null,
    rating: r.rating ?? null,
    note: r.note?.trim() || null,
  };
});

FILE.episodes?.forEach((r, i) => {
  if (r.url) SOURCE_URL[REAL_EPISODES[i].id] = r.url.trim();
});

// ---------------- 示例稿：挂在真实的那一期上 ----------------
// 《壮游者》159 芬兰那期自带用户提供的完整逐字稿，用来展示「逐字稿 + 导图」的成品形态；
// 它本身就是清单里的一期，不再单独造一条假数据。
const DEMO_URL_KEY = "648f8666c442eecf6aaabe0c";

export const DEMO_SUMMARY =
  "本期《壮游者》带你走进芬兰。旅居芬兰的金缮修复师李立，以节日为线索，串起芬兰的四季生活：从主显节扔掉圣诞树、理直气壮的滑雪假，到复活节的曼米甜点、五月的奇特习俗；从邻里烤香肠的无声较量、仲夏节的重金属狂欢，到维京节的传统重现、夏日的森林之约，再到「神经正常的人不会在十一月来芬兰」的调侃，以及热的桑拿与冷的人。节目用一个个人的、细节的视角，重新认识这个常被「世界第一」标签化的国家。";

export const GUEST_EPISODES: Episode[] = REAL_EPISODES;

/** 带完整示例逐字稿的那一期（列表里的真实一期） */
export const DEMO_GUEST_ID =
  GUEST_EPISODES.find((e) => (e.source_url ?? "").includes(DEMO_URL_KEY))?.id ??
  GUEST_EPISODES[0]?.id ??
  "";

/** 真实播客不内置逐字稿全文（版权归主播/平台）；只有芬兰那期带示例稿。 */
export const GUEST_SEGMENTS: Record<string, TranscriptSegment[]> = {
  [DEMO_GUEST_ID]: demoTranscript as TranscriptSegment[],
};


export const GUEST_SUMMARY: Record<string, string> = {
  ...Object.fromEntries(
    (FILE.episodes ?? []).map((r, i) => [REAL_EPISODES[i].id, r.blurb?.trim() || ""])
  ),
  [DEMO_GUEST_ID]: DEMO_SUMMARY,
};

/** 只放用户亲手挑的、注明出处的短句；不生成、不摘录全文 */
export const GUEST_QUOTES: Record<string, string[]> = {
  ...Object.fromEntries(
    (FILE.episodes ?? []).map((r, i) => [REAL_EPISODES[i].id, r.quote?.trim() ? [r.quote.trim()] : []])
  ),
  [DEMO_GUEST_ID]: ["神经正常的人不会在十一月来芬兰。"],
};

export const GUEST_CARD: Record<string, GuestCard> = {
  ...Object.fromEntries(CARDS.map((c, i) => [REAL_EPISODES[i].id, c])),
  [DEMO_GUEST_ID]: {
    seed: -1,
    show: "壮游者",
    showColor: "#6f8fa8",
    title: "159 | 芬兰 | 不调休的假",
    subject: "159 | 芬兰 | 不调休的假",
    platform: "xiaoyuzhou",
    no: "159",
    topicId: "guest-t-02",
    topicName: "旅游",
    url: `https://www.xiaoyuzhoufm.com/episode/${DEMO_URL_KEY}`,
  },
};

/**
 * 卡片/详情用哪张封面。
 * 默认用节目封面：同一档节目的十几期看起来是一套，而不是十几张花絮图。
 * 想换回单集封面，把这里改成 `ep.cover_url ?? ep.show_cover_url` 即可。
 */
/** 封面：优先高清。小宇宙的图床支持 imageView2 参数，把尺寸顶到 800 再显示 */
export function hdCover(url: string | null | undefined, size = 800): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/xyzcdn|xiaoyuzhoufm/.test(u.hostname)) {
      u.search = `?imageView2/1/w/${size}/h/${size}/format/webp`;
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function displayCover(ep: Episode): string | null {
  return hdCover(ep.show_cover_url || ep.cover_url || null) || ep.show_cover_url || ep.cover_url || null;
}

export function sourceUrlOf(id: string): string | null {
  return SOURCE_URL[id] ?? null;
}

export type Facet = { key: string; label: string; count: number };
function tally(items: string[], order?: string[]): Facet[] {
  const m = new Map<string, number>();
  items.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
  const list = [...m.entries()].map(([key, count]) => ({ key, label: key, count }));
  if (order) list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  else list.sort((a, b) => b.count - a.count);
  return list;
}

export const GUEST_FACETS: { show: Facet[]; topic: Facet[]; platform: Facet[]; month: Facet[] } = {
  show: tally(CARDS.map((c) => c.show)),
  topic: tally(CARDS.map((c) => c.topicName), GUEST_TOPICS.map((t) => t.name)),
  platform: tally(CARDS.map((c) => PLATFORM_LABEL[c.platform])),
  month: (() => {
    const keys = [...new Set(GUEST_EPISODES.map((e) => (e.added_at ?? "").slice(0, 7)))].filter(Boolean).sort().reverse();
    return keys.map((m) => ({
      key: m,
      label: `${m.slice(2, 4)}.${m.slice(5, 7)}`,
      count: GUEST_EPISODES.filter((e) => (e.added_at ?? "").startsWith(m)).length,
    }));
  })(),
};

export const GUEST_STATS = {
  episodes: REAL_EPISODES.length,
  topics: GUEST_TOPICS.length,
  shows: GUEST_FACETS.show.length,
  platforms: GUEST_FACETS.platform.length,
  months: GUEST_FACETS.month.length,
  hours: Math.round(REAL_EPISODES.reduce((s, e) => s + (e.duration_sec ?? 0), 0) / 3600),
};

export function findGuestEpisode(id: string): Episode | null {
  return GUEST_EPISODES.find((e) => e.id === id) ?? null;
}

export function isLocalEpisodeId(id: string) {
  return id.startsWith("guest-local-");
}

/** 清单是否还是空的：页面据此切到「空位书」引导态 */
export const GUEST_LIBRARY_EMPTY = GUEST_EPISODES.length === 0;
