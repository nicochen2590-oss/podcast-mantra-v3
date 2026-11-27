export type Episode = {
  id: string;
  title: string;
  episode_no: string | null;
  cover_url: string | null;
  /** 节目（show）的封面：卡片统一用它，同一档节目的期看起来才像一套 */
  show_cover_url?: string | null;
  show_id?: string | null;
  audio_url?: string | null;
  /** 原平台链接：公开索引里有；自己粘进来的那条也留一份，方便「去原平台收听」 */
  source_url?: string | null;
  platform: "xiaoyuzhou" | "bilibili" | "douyin" | "xiaohongshu" | "other";
  duration_sec: number | null;
  published_at: string | null;
  transcript_status: "pending" | "processing" | "ready" | "failed";
  created_at: string;
  topic_id: string | null;
  author?: string | null;
  summary?: string | null;
  rating?: number | null;
  note?: string | null;
  added_at?: string | null;
};

export type Topic = {
  id: string;
  name: string;
  color: string | null;
};

/** 从逐字稿里拎出来的术语卡（参考 Snipd 的 Keywords） */
export type KeywordCard = {
  term: string;
  brief: string;
  /** 重要程度 1–5：越大字号越重 */
  weight?: number;
  /** 主题 / 概念 / 实体：决定颜色 */
  kind?: "theme" | "concept" | "entity";
};

/** 金句/高光：一句值得回听的话 + 它的时间点（可带自己的评论） */
export type Highlight = {
  id?: string;
  start_ms: number;
  text: string;
  /** 自己的批注：为什么这句值得留下 */
  note?: string | null;
  /** 手动从逐字稿里选出来的（true），还是自动挑的 */
  user?: boolean;
};

/** 知识文章：AI 按主题重组后、可脱离音频独立阅读的专题 */
export type ArticleSection = {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  /** 这一节的内容来自哪几段音频；时间码必须来自原始 ASR */
  sources: { start_ms: number; end_ms: number }[];
};
export type KnowledgeArticle = { title: string; intro: string; sections: ArticleSection[] };

/** 章节：按话题变化切出来的一段 */
export type Chapter = {
  title: string;
  start_ms: number;
  end_ms: number;
  core: string;
  points: string[];
  quotes: string[];
};

/** 整期概览：一句话 / 背景 / 核心模块 / 结论 / 适合谁 */
export type Overview = {
  one_line: string;
  background: string[];
  core: { title: string; point: string; start_ms: number }[];
  conclusion: string;
  audience: string;
  incomplete?: boolean;
};

/** 核心观点：标题 + 解释 + 依据 + 时间 */
export type Takeaway = {
  title: string;
  explain: string;
  evidence: string;
  start_ms: number;
  chapter?: string;
};

export type ActionInsight = { text: string; start_ms: number; declared: boolean };
export type ExampleStory = { text: string; start_ms: number };

/** 某一期里自己写的一条笔记 */
export type EpisodeNote = { id: string; text: string; at: string };

export type TranscriptSegment = {
  seq: number;
  /** 这一段落属于哪个章节（自动分章后填上） */
  topic?: string | null;
  start_ms: number;
  end_ms: number | null;
  speaker: string | null;
  text: string;
  text_en: string | null;
  gist?: string | null;
};
