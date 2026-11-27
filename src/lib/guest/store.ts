/**
 * 本机书斋的存储层（免登录之后，这里是唯一的「写」入口）。
 *
 * 三份东西分开存，互不干扰：
 *   pm_guest_library_v1     — 自己粘进来的一期、自己建的专辑
 *   pm_episode_meta         — 花朵评分 / 余音 / 归属专辑（公开索引里的期也能改）
 *   pm_guest_transcripts_v1 — 自己粘的逐字稿与据此生成的导图（按 episode id 存）
 *
 * 为什么不用一个 key：公开索引那 55 期是只读的公共数据，用户改动要能被
 * 「叠加」上去，而不是把整份公共清单复制进浏览器——清单更新时才不会丢。
 */
import type {
  Episode, Topic, TranscriptSegment, KeywordCard, Highlight, EpisodeNote,
  Chapter, Overview, Takeaway, ActionInsight, ExampleStory, KnowledgeArticle,
} from "@/app/dashboard/types";
import type { ParsedEpisode } from "@/lib/parse/xiaoyuzhou";
import type { MindNode } from "@/lib/mindmap";

export const GUEST_LIB_KEY = "pm_guest_library_v1";
export const GUEST_META_KEY = "pm_episode_meta";
export const GUEST_TRANSCRIPT_KEY = "pm_guest_transcripts_v1";

export type GuestLibrary = { episodes: Episode[]; topics: Topic[] };

const EMPTY: GuestLibrary = { episodes: [], topics: [] };

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满时仍让本次会话可用 */
  }
}

// ---------- 自己收进来的一期 ----------

export function loadGuestLibrary(): GuestLibrary {
  const g = readJson<Partial<GuestLibrary>>(GUEST_LIB_KEY, EMPTY);
  return {
    episodes: Array.isArray(g.episodes) ? g.episodes : [],
    topics: Array.isArray(g.topics) ? g.topics : [],
  };
}

export function writeGuestLibrary(g: GuestLibrary): GuestLibrary {
  writeJson(GUEST_LIB_KEY, g);
  return g;
}

export function addGuestEpisode(ep: Episode): GuestLibrary {
  const g = loadGuestLibrary();
  return writeGuestLibrary({ ...g, episodes: [ep, ...g.episodes.filter((e) => e.id !== ep.id)] });
}

export function addGuestTopic(t: Topic): GuestLibrary {
  const g = loadGuestLibrary();
  const key = (n: string | null | undefined) => String(n ?? "").replace(/\s/g, "").trim();
  const dup = g.topics.find((x) => key(x.name) === key(t.name));
  if (dup) return g; // 同名专辑已存在，不再新建
  return writeGuestLibrary({ ...g, topics: [...g.topics, t] });
}

/** 合并同名专辑：把重复专辑里的期挪到第一张，然后删掉多余的 */
export function mergeDuplicateTopics(): { merged: number; moved: number } {
  const g = loadGuestLibrary();
  const key = (n: string | null | undefined) => String(n ?? "").replace(/\s/g, "").trim();
  const keep = new Map<string, Topic>();
  const drop = new Set<string>();
  for (const t of g.topics) {
    const k = key(t.name);
    if (keep.has(k)) drop.add(t.id);
    else keep.set(k, t);
  }
  if (!drop.size) return { merged: 0, moved: 0 };

  const idMap = new Map<string, string>();
  g.topics.forEach((t) => {
    const k = key(t.name);
    const target = keep.get(k);
    if (target && target.id !== t.id) idMap.set(t.id, target.id);
  });
  let moved = 0;
  const episodes = g.episodes.map((e) => {
    const to = idMap.get(String(e.topic_id ?? ""));
    if (!to) return e;
    moved += 1;
    return { ...e, topic_id: to };
  });
  writeGuestLibrary({ ...g, episodes, topics: g.topics.filter((t) => !drop.has(t.id)) });
  return { merged: drop.size, moved };
}

/** 改本地这一期的归属专辑 / 简介等（公开索引的期不走这里） */
export function updateGuestEpisode(id: string, patch: Partial<Episode>): GuestLibrary {
  const g = loadGuestLibrary();
  return writeGuestLibrary({
    ...g,
    episodes: g.episodes.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  });
}

export function removeGuestEpisode(id: string): GuestLibrary {
  const g = loadGuestLibrary();
  removeLocalTranscript(id);
  return writeGuestLibrary({ ...g, episodes: g.episodes.filter((e) => e.id !== id) });
}

// ---------- 隐藏：公共索引删不掉，但可以「从我的书斋里拿走」 ----------

const HIDDEN_EP_KEY = "pm_hidden_episodes_v1";
const HIDDEN_TOPIC_KEY = "pm_hidden_topics_v1";

export function loadHiddenEpisodes(): string[] {
  const v = readJson<string[]>(HIDDEN_EP_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function hideEpisodes(ids: string[]) {
  const set = new Set([...loadHiddenEpisodes(), ...ids]);
  writeJson(HIDDEN_EP_KEY, [...set]);
}

export function unhideEpisode(id: string) {
  writeJson(HIDDEN_EP_KEY, loadHiddenEpisodes().filter((x) => x !== id));
}

export function loadHiddenTopics(): string[] {
  const v = readJson<string[]>(HIDDEN_TOPIC_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function hideTopic(id: string) {
  const set = new Set([...loadHiddenTopics(), id]);
  writeJson(HIDDEN_TOPIC_KEY, [...set]);
}

// ---------- 逐字稿 + 导图 ----------

export type LocalTranscript = {
  /** paste = 自己粘的；asr = 站内自动转写 */
  source: "paste" | "asr";
  segments: TranscriptSegment[];
  mindmap: MindNode | null;
  /** 自动转写时顺手生成的：概要、术语卡、高光 */
  summary?: string | null;
  /** 知识文章（默认阅读形态） */
  article?: KnowledgeArticle | null;
  /** 大模型按语义断好的句子（原始 ASR 仍保留在 segments 里） */
  sentences?: TranscriptSegment[] | null;
  /** 编辑版逐字稿：章节 + 带标点的段落（不覆盖 segments） */
  edited_transcript?: { chapters: { index: number; title: string; summary: string; start_ms: number; end_ms: number; paragraphs: { t: number; text: string }[] }[] } | null;
  chapters?: Chapter[];
  overview?: Overview | null;
  takeaways?: Takeaway[];
  quotes?: { text: string; start_ms: number }[];
  actions?: ActionInsight[];
  examples?: ExampleStory[];
  questions?: string[];
  /** 自己改过的摘要（优先于自动生成的那份） */
  summary_override?: string | null;
  keywords?: KeywordCard[] | null;
  highlights?: Highlight[] | null;
  /** 这次整理用的是大模型还是本地规则 */
  llm?: boolean;
  quality_note?: string | null;
  /** 进度：已转到的秒数（断点续传用） */
  cursor_sec?: number;
  total_sec?: number;
  updated_at: string;
};

type TranscriptMap = Record<string, LocalTranscript>;

export function loadTranscriptMap(): TranscriptMap {
  return readJson<TranscriptMap>(GUEST_TRANSCRIPT_KEY, {});
}

export function getLocalTranscript(id: string): LocalTranscript | null {
  const t = loadTranscriptMap()[id];
  if (!t || !Array.isArray(t.segments) || !t.segments.length) return null;
  return t;
}

export function saveLocalTranscript(
  id: string,
  segments: TranscriptSegment[],
  mindmap: MindNode | null,
  extra: Partial<Omit<LocalTranscript, "segments" | "mindmap" | "updated_at">> = {}
): LocalTranscript {
  const map = loadTranscriptMap();
  const entry: LocalTranscript = {
    source: extra.source ?? "paste",
    segments,
    mindmap,
    ...extra,
    updated_at: new Date().toISOString(),
  };
  map[id] = entry;
  writeJson(GUEST_TRANSCRIPT_KEY, map);
  return entry;
}

/** 局部更新某期的稿子（改摘要、加/删金句、写批注） */
export function patchLocalTranscript(id: string, patch: Partial<LocalTranscript>): LocalTranscript | null {
  const map = loadTranscriptMap();
  const cur = map[id];
  if (!cur) return null;
  map[id] = { ...cur, ...patch, updated_at: new Date().toISOString() };
  writeJson(GUEST_TRANSCRIPT_KEY, map);
  return map[id];
}

// ---------- 专辑的专题摘要 / 笔记 ----------

const TOPIC_META_KEY = "pm_topic_meta_v1";
export type TopicMeta = { summary?: string | null; note?: string | null };

export function loadTopicMeta(): Record<string, TopicMeta> {
  return readJson<Record<string, TopicMeta>>(TOPIC_META_KEY, {});
}

export function saveTopicMeta(id: string, patch: TopicMeta) {
  const all = loadTopicMeta();
  all[id] = { ...(all[id] ?? {}), ...patch };
  writeJson(TOPIC_META_KEY, all);
}

// ---------- 每期的笔记 ----------

const NOTES_KEY = "pm_episode_notes_v1";

export function loadNotes(id: string): EpisodeNote[] {
  const all = readJson<Record<string, EpisodeNote[]>>(NOTES_KEY, {});
  const list = all[id];
  return Array.isArray(list) ? list : [];
}

export function addNote(id: string, text: string): EpisodeNote[] {
  const all = readJson<Record<string, EpisodeNote[]>>(NOTES_KEY, {});
  const list = Array.isArray(all[id]) ? all[id] : [];
  const note: EpisodeNote = { id: `n-${Date.now()}`, text: text.trim(), at: new Date().toISOString() };
  all[id] = [note, ...list];
  writeJson(NOTES_KEY, all);
  return all[id];
}

export function removeNote(id: string, noteId: string): EpisodeNote[] {
  const all = readJson<Record<string, EpisodeNote[]>>(NOTES_KEY, {});
  const list = (Array.isArray(all[id]) ? all[id] : []).filter((n) => n.id !== noteId);
  all[id] = list;
  writeJson(NOTES_KEY, all);
  return list;
}

export function removeLocalTranscript(id: string) {
  const map = loadTranscriptMap();
  if (!(id in map)) return;
  delete map[id];
  writeJson(GUEST_TRANSCRIPT_KEY, map);
}

// ---------- 从解析结果造一条本地的一期 ----------

/** 把解析结果变成本地一期；id 用 guest-local- 前缀，详情页能识别出「本机条目」 */
export function makeLocalEpisode(p: ParsedEpisode, topicId: string): Episode {
  const now = new Date().toISOString();
  return {
    id: `guest-local-${Date.now()}`,
    title: p.title,
    episode_no: p.episode_no,
    cover_url: p.cover_url,
    show_cover_url: p.show?.cover_url ?? null,
    show_id: p.show?.platform_id ?? null,
    audio_url: p.audio_url,
    source_url: p.source_url,
    platform: p.platform,
    duration_sec: p.duration_sec,
    published_at: p.published_at,
    transcript_status: "pending",
    created_at: now,
    added_at: now,
    topic_id: topicId || null,
    author: p.show?.title ?? null,
    summary: p.description,
    rating: null,
    note: null,
  };
}

export function makeLocalTopic(name: string, color: string): Topic {
  return { id: `guest-local-t-${Date.now()}`, name, color };
}

/** 这一期的原平台链接（自己粘的条目在本地留了 source_url） */
export function localSourceUrl(ep: Episode): string | null {
  return ep.source_url ?? null;
}


/** 10 个一级分类（唯一标准） */
export const CANONICAL_TOPICS = [
  "文学与阅读", "历史与文明", "哲学与思想", "艺术与审美", "影视与流行文化",
  "社会观察", "女性与性别", "心理与情绪", "自我成长", "职业与职场",
  "商业与创业", "经济与金融", "人工智能", "科技与互联网", "国际关系与时事",
  "法律与公共制度", "医疗与健康", "教育与学习", "旅行与地理", "生活与消费",
] as const;

const TOPIC_SYNONYMS: { name: string; words: string[] }[] = [
  { name: "文学与阅读", words: ["文学", "阅读", "小说", "诗歌", "写作", "作家"] },
  { name: "历史与文明", words: ["历史", "文明", "古代", "朝代"] },
  { name: "哲学与思想", words: ["哲学", "思想", "伦理", "佛学", "道家", "价值观"] },
  { name: "艺术与审美", words: ["艺术", "审美", "绘画", "美术", "建筑", "设计", "摄影"] },
  { name: "影视与流行文化", words: ["影视", "电影", "电视剧", "综艺", "游戏", "明星", "流行", "娱乐"] },
  { name: "女性与性别", words: ["女性", "性别", "性别平等", "生育"] },
  { name: "心理与情绪", words: ["心理", "情绪", "焦虑", "抑郁", "疗愈", "咨询"] },
  { name: "自我成长", words: ["自我", "成长", "习惯", "自律", "人生", "长期主义"] },
  { name: "职业与职场", words: ["职业", "职场", "领导力", "团队", "办公室"] },
  { name: "商业与创业", words: ["商业", "创业", "品牌", "营销", "经营", "商业模式", "企业"] },
  { name: "经济与金融", words: ["经济", "金融", "财经", "投资", "股票", "基金", "理财", "宏观"] },
  { name: "人工智能", words: ["人工智能", "ai", "大模型", "算法", "机器学习", "智能体", "agent"] },
  { name: "科技与互联网", words: ["科技", "互联网", "产品", "软件", "硬件", "数码", "智能设备"] },
  { name: "国际关系与时事", words: ["国际", "时政", "外交", "地缘", "新闻", "时事", "冲突"] },
  { name: "法律与公共制度", words: ["法律", "司法", "宪法", "制度", "公共管理", "治理"] },
  { name: "医疗与健康", words: ["医疗", "健康", "医学", "疾病", "营养", "运动", "睡眠", "健身"] },
  { name: "教育与学习", words: ["教育", "学习", "知识管理", "教学", "认知科学", "语言学习"] },
  { name: "旅行与地理", words: ["旅行", "旅游", "地理", "目的地", "城市探索"] },
  { name: "生活与消费", words: ["生活", "消费", "饮食", "美食", "家庭", "居住", "休闲"] },
  { name: "社会观察", words: ["社会", "观察", "阶层", "群体", "公共议题", "代际", "城乡"] },
];

/** 任意专辑名 → 10 个标准分类之一（认不出就归到社会观察） */
export function canonicalTopic(name: string): string {
  const n = String(name ?? "").trim();
  if ((CANONICAL_TOPICS as readonly string[]).includes(n)) return n;
  const low = n.toLowerCase();
  for (const { name: canon, words } of TOPIC_SYNONYMS) {
    if (words.some((w) => low.includes(w) || n.includes(w))) return canon;
  }
  return "社会观察";
}

/** 把所有专辑收敛成 10 个：同名/近义的合并，期重新挂到标准分类下 */
export function normalizeAlbums(): { before: number; after: number; moved: number } {
  const g = loadGuestLibrary();
  const before = g.topics.length;
  const byCanon = new Map<string, Topic>();
  const idMap = new Map<string, string>();

  for (const t of g.topics) {
    const canon = canonicalTopic(t.name);
    const exist = byCanon.get(canon);
    if (exist) idMap.set(t.id, exist.id);
    else byCanon.set(canon, { ...t, name: canon });
  }
  // 缺哪个标准分类就补一个
  for (const name of CANONICAL_TOPICS) {
    if (!byCanon.has(name)) {
      byCanon.set(name, { id: `local-${name}-${Math.random().toString(36).slice(2, 6)}`, name, color: null });
    }
  }

  let moved = 0;
  const episodes = g.episodes.map((e) => {
    const cur = g.topics.find((x) => x.id === e.topic_id);
    const canon = cur ? canonicalTopic(cur.name) : "社会观察";
    const target = byCanon.get(canon)!;
    if (target.id !== e.topic_id) moved += 1;
    return { ...e, topic_id: target.id };
  });

  writeGuestLibrary({ ...g, episodes, topics: [...byCanon.values()] });
  return { before, after: byCanon.size, moved };
}


/** 彻底重建 10 个标准专辑：清掉隐藏记录，重新发 id，把每期按分类挂回去 */
export function rebuildCanonicalAlbums(): { created: number; moved: number } {
  // 1) 清空专辑隐藏名单（否则重建了也看不见）
  try { writeJson(HIDDEN_TOPIC_KEY, []); } catch { /* 忽略 */ }

  const g = loadGuestLibrary();
  const byCanon = new Map<string, Topic>();
  for (const name of CANONICAL_TOPICS) {
    byCanon.set(name, {
      id: `topic-${name}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      color: null,
    });
  }

  let moved = 0;
  const episodes = g.episodes.map((e) => {
    const old = g.topics.find((x) => x.id === e.topic_id);
    const canon = old ? canonicalTopic(old.name) : "社会观察";
    const target = byCanon.get(canon) ?? byCanon.get("社会观察")!;
    if (target.id !== e.topic_id) moved += 1;
    return { ...e, topic_id: target.id };
  });

  writeGuestLibrary({ ...g, episodes, topics: [...byCanon.values()] });
  return { created: byCanon.size, moved };
}


/** 重命名专辑（只改名字，期数与关联都不动） */
export function renameTopicById(id: string, name: string): boolean {
  const clean = name.trim();
  if (!clean) return false;
  const g = loadGuestLibrary();
  if (g.topics.some((t) => t.id !== id && t.name === clean)) return false;
  writeGuestLibrary({ ...g, topics: g.topics.map((t) => (t.id === id ? { ...t, name: clean } : t)) });
  return true;
}
