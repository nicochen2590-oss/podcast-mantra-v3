"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronDown, Headphones, Clock, Calendar, FolderOpen, Sparkles,
  Play, Pause, SkipBack, SkipForward, Volume2, BookOpen, Languages,
  CheckCircle2, Loader2, AlertCircle, Copy, Check, RotateCw, Network,
  FileText, X, Save, ArrowUpRight, Trash2, Gauge, Lightbulb, Quote, Info,
  Wand2, Square, Search, Feather, Link2, Plus, Pencil, Download,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type {
  Episode, Topic, TranscriptSegment, KeywordCard, Highlight, EpisodeNote,
  Chapter, Overview, Takeaway, ActionInsight, ExampleStory, KnowledgeArticle,
} from "@/app/dashboard/types";
import type { MindNode } from "@/lib/mindmap";
import { patchLocalTranscript } from "@/lib/guest/store";
import { TranscribeDriver } from "@/app/dashboard/transcribe-driver";
import { MindMap } from "./mindmap";
import { estimateSeconds } from "@/lib/guest/transcript";
import { DEMO_GUEST_ID, displayCover } from "@/lib/guest/data";

const PLATFORM_LABEL: Record<string, string> = {
  xiaoyuzhou: "小宇宙", bilibili: "B站", douyin: "抖音", xiaohongshu: "小红书", other: "其他",
};

/** 把节目简介按句子切成几段，别堆成一大块 */
function toParagraphs(text: string, maxSent = 2): string[] {
  const clean = (text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  const blocks = clean.split(/\n{2,}|\n/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (const b of blocks) {
    const sents = b.match(/[^。！？!?]+[。！？!?]?/g) || [b];
    let buf = "";
    let n = 0;
    for (const s of sents) {
      buf += s;
      n += 1;
      if (n >= maxSent || buf.length > 90) { out.push(buf.trim()); buf = ""; n = 0; }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** 从段落里取第一句，截到 22 字以内，用作导图节点/时间轴要点 */
function firstClause(text: string, max = 22): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  const m = clean.match(/^[^。！？!?；;]+[。！？!?]?/);
  const head = (m ? m[0] : clean).replace(/[。！？!?]$/, "");
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}小时${m % 60}分` : `${m}分钟`;
}
function ts(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function fmtDate(s: string | null) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function gistOf(seg: TranscriptSegment) {
  if (seg.gist && seg.gist.trim()) return seg.gist.trim();
  const first = seg.text.split(/[。！？!?；;]/)[0] || seg.text;
  return first.length > 26 ? `${first.slice(0, 26)}…` : first;
}

type TabKey = "knowledge" | "mindmap" | "timeline" | "transcript" | "essence" | "related";

export type AsrState = {
  status: "idle" | "running" | "done" | "error";
  cursor: number;
  total: number;
  message?: string;
};

export type Related = {
  episodes: Episode[];
  topics: Topic[];
  sharedKeywords: { term: string; episodes: string[] }[];
};

const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: "knowledge", label: "知识阅读", icon: BookOpen },
  { key: "mindmap", label: "导图", icon: Network },
  { key: "timeline", label: "时间轴", icon: Clock },
  { key: "transcript", label: "逐字稿", icon: Languages },
  { key: "essence", label: "精华", icon: Sparkles },
  { key: "related", label: "关联", icon: Network },
];

/** 去掉 ASR 复读：同一短语连续出现 4 次以上只留一次（含 mecatecate… 这类无空格粘连） */
function cleanLoops(text: string): string {
  if (!text) return text;
  return text
    .replace(/(.{2,8}?)\1{3,}/g, "$1")
    .replace(/\s{2,}/g, " ");
}

export function EpisodeDetail({
  episode, topic, segments, summary, mindmap, isDemo,
  local = false, sample = false, onSaveTranscript, onClearTranscript,
  keywords, highlights, insightSummary,
  asr, onStartAsr, onStopAsr, onHydrateAudio, onRetranscribe,
  notes, onAddNote, onRemoveNote,
  onSaveSummary, onAddHighlight, onUpdateHighlightNote, onRemoveHighlight,
  related, topics, onMoveToAlbum,
  article, sentences, edited,
  chapters, overview, takeaways, quotes, actions, examples, questions,
  llmUsed, qualityNote, reanalyzing, onReanalyze,
  analyzing, analyzeSec = 0, analyzeStep = 0,
}: {
  episode: Episode; topic: Topic | null; segments: TranscriptSegment[];
  summary: string | null; mindmap: MindNode | null; isDemo: boolean;
  local?: boolean;
  sample?: boolean;
  onSaveTranscript?: (text: string) => void;
  onClearTranscript?: () => void;
  keywords?: KeywordCard[] | null;
  highlights?: Highlight[] | null;
  insightSummary?: string | null;
  asr?: AsrState;
  onStartAsr?: () => void;
  onRetranscribe?: () => void;
  onStopAsr?: () => void;
  onHydrateAudio?: () => void;
  notes?: EpisodeNote[];
  onAddNote?: (text: string) => void;
  onRemoveNote?: (id: string) => void;
  onSaveSummary?: (text: string | null) => void;
  onAddHighlight?: (h: Highlight) => void;
  onUpdateHighlightNote?: (id: string, note: string) => void;
  onRemoveHighlight?: (id: string) => void;
  related?: Related | null;
  article?: KnowledgeArticle | null;
  sentences?: TranscriptSegment[] | null;
  edited?: {
    chapters: { index: number; title: string; summary: string; start_ms: number; end_ms: number; paragraphs: { t: number; text: string }[] }[];
  } | null;
  chapters?: Chapter[];
  overview?: Overview | null;
  takeaways?: Takeaway[];
  quotes?: { text: string; start_ms: number }[];
  actions?: ActionInsight[];
  examples?: ExampleStory[];
  questions?: (string | { q: string; why?: string })[];
  topics?: Topic[];
  onMoveToAlbum?: (topicId: string) => void;
  llmUsed?: boolean | null;
  qualityNote?: string | null;
  reanalyzing?: boolean;
  onReanalyze?: () => void;
  analyzing?: boolean;
  analyzeSec?: number;
  analyzeStep?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("knowledge");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);
  const [copied, setCopied] = useState(false);
  const [transcribePct, setTranscribePct] = useState<number | null>(null);
  const [status, setStatus] = useState(episode.transcript_status);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  // 逐字稿搜索
  const [search, setSearch] = useState("");
  // 选中划词保存金句
  const [picked, setPicked] = useState<{ text: string; start_ms: number; x: number; y: number } | null>(null);
  // 编辑摘要
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  // 笔记输入
  const [noteDraft, setNoteDraft] = useState("");
  // 金句批注
  const [commentFor, setCommentFor] = useState<string | null>(null);
  // 逐字稿：复制 / 导出
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [reBusy, setReBusy] = useState(false);
  const [reMsg, setReMsg] = useState("");

  async function runReanalyze() {
    if (reBusy) return;
    if (!segments.length) {
      setReMsg("这一期还没有逐字稿，先转写再整理。");
      return;
    }
    setReBusy(true);
    setReMsg("正在整理…（约 20–60 秒）");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: episode.title,
          segments: segments.map((x) => ({ start_ms: x.start_ms, text: x.text })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      const patch = {
        chapters: j.chapters ?? [],
        overview: j.overview ?? null,
        takeaways: j.takeaways ?? [],
        quotes: j.quotes ?? [],
        actions: j.actions ?? [],
        examples: j.examples ?? [],
        questions: j.questions ?? [],
        keywords: j.keywords ?? null,
        article: j.article ?? null,
        sentences: j.segments ?? null,
        edited_transcript: j.edited_transcript ?? null,
        mindmap: j.mindmap ?? mindmap ?? null,
        llm: !!j.llm,
        quality_note: j.quality_note ?? null,
      };
      patchLocalTranscript(episode.id, patch as never);
      setReMsg("整理完成，正在刷新…");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      setReMsg(`整理失败：${e instanceof Error ? e.message : "请求出错"}`);
      setReBusy(false);
    }
  }
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem("pm_transcribe_requests") || "[]") as string[];
      setRequested(list.includes(episode.id));
    } catch { /* 忽略 */ }
  }, [episode.id]);

  function requestTranscribe() {
    try {
      const list = JSON.parse(localStorage.getItem("pm_transcribe_requests") || "[]") as string[];
      if (!list.includes(episode.id)) list.push(episode.id);
      localStorage.setItem("pm_transcribe_requests", JSON.stringify(list));
    } catch { /* 存不下也照样提示 */ }
    // 同时提交到队列，管理员那边能看到真实申请
    void fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episode_id: episode.id, title: episode.title, source_url: episode.source_url }),
    }).catch(() => { /* 网络失败不影响本地标记 */ });
    setRequested(true);
  }
  const [commentDraft, setCommentDraft] = useState("");

  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setStatus(episode.transcript_status); }, [episode.transcript_status]);

  useEffect(() => {
    if (!episode.audio_url && episode.source_url) onHydrateAudio?.();
  }, [episode.id, episode.audio_url, episode.source_url, onHydrateAudio]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [episode.audio_url]);

  const activeIdx = useMemo(
    () => segments.reduce((acc, s, i) => (current >= s.start_ms ? i : acc), -1),
    [segments, current]
  );

  useEffect(() => {
    if (!playing || activeIdx < 0) return;
    const seg = segments[activeIdx];
    if (!seg) return;
    setOpen((prev) => (prev.has(seg.seq) ? prev : new Set(prev).add(seg.seq)));
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, playing]);

  const transcribing = !isDemo && !local && !sample && status !== "ready";
  const asrRunning = asr?.status === "running";
  const shownSummary = summary || insightSummary;

  const viewSegments = useMemo(
    () => (rawMode || !sentences?.length ? segments : sentences),
    [rawMode, sentences, segments]
  );
  // 阅读版：优先用编辑版（有标点、有章节），否则按句群 + 章节时间码规则分组
  const reader = useMemo(() => {
    const src = (sentences?.length ? sentences : segments).filter((x) => x.text.trim());
    const groupPara = (list: typeof src, startMs: number) => {
      const out: { t: number; text: string }[] = [];
      for (let i = 0; i < list.length; i += 3) {
        const chunk = list.slice(i, i + 3);
        out.push({ t: chunk[0].start_ms, text: chunk.map((x) => x.text.trim()).join(" ") });
      }
      if (!out.length) out.push({ t: startMs, text: "" });
      return out;
    };

    if (edited?.chapters?.length) {
      return edited.chapters.map((c) => ({
        index: c.index,
        title: c.title,
        summary: c.summary,
        start_ms: c.start_ms,
        end_ms: c.end_ms,
        paragraphs: c.paragraphs,
      }));
    }
    if (chapters?.length) {
      return chapters.map((c, i) => {
        const list = src.filter((x) => x.start_ms >= c.start_ms && (!c.end_ms || x.start_ms < c.end_ms));
        return {
          index: i + 1,
          title: c.title,
          summary: c.core ?? "",
          start_ms: c.start_ms,
          end_ms: c.end_ms ?? (list.at(-1)?.start_ms ?? c.start_ms),
          paragraphs: groupPara(list, c.start_ms),
        };
      });
    }
    return [{ index: 1, title: "全文", summary: "", start_ms: src[0]?.start_ms ?? 0, end_ms: src.at(-1)?.start_ms ?? 0, paragraphs: groupPara(src, src[0]?.start_ms ?? 0) }];
  }, [edited, chapters, sentences, segments]);

  // 时间轴：优先用文章章节（标题 + 一句概述 + 3 条要点）
  const timeline = useMemo(() => {
    if (article?.sections?.length) {
      return article.sections.map((sec, i) => {
        const paras = sec.content.split(/\n{2,}/).map((x) => firstClause(x, 26)).filter(Boolean).slice(0, 3);
        return {
          start_ms: sec.sources[0]?.start_ms ?? 0,
          end_ms: sec.sources.at(-1)?.end_ms ?? 0,
          title: sec.title,
          core: sec.summary || "",
          points: paras.length ? paras : [firstClause(sec.content, 30)],
          key: sec.id || String(i),
        };
      });
    }
    return (chapters ?? []).map((c, i) => ({
      start_ms: c.start_ms, end_ms: c.end_ms ?? 0, title: c.title, core: c.core ?? "",
      points: c.points ?? [], key: String(i),
    }));
  }, [article, chapters]);

  // 导图：三级节点用文章里的句子，而不是几个关键词
  // 导图：一级=文章章节，二级=该章节覆盖范围内的「结构要点」（有意义的短句），
  // 没有要点才退回该节每段的第一句。
  const mapData = useMemo(() => {
    const GREET = /^(大家好|各位好|你好|欢迎|我是|这里是|早上好|晚上好|哈喽|hello|hi\b)/i;
    const clean = (t: string) => t.replace(/[…\.]+$/, "").trim();

    if (article?.sections?.length) {
      const chs = chapters ?? [];
      const children = article.sections
        .filter((sec) => !GREET.test(sec.title.trim()) && !GREET.test(sec.content.trim().slice(0, 8)))
        .map((sec) => {
          const start = sec.sources[0]?.start_ms ?? 0;
          const end = sec.sources.at(-1)?.end_ms ?? start + 15 * 60 * 1000;
          const fromChapters = chs
            .filter((c) => c.start_ms >= start - 60000 && c.start_ms <= end)
            .flatMap((c) => c.points ?? []);
          const fallback = sec.content.split(/\n{2,}/).map((x) => firstClause(x, 26));
          const kids = (fromChapters.length ? fromChapters : fallback)
            .map(clean)
            .filter((t) => t && t.length >= 6 && !GREET.test(t))
            .slice(0, 4)
            .map((t) => ({ name: t, start_ms: start }));
          return { name: sec.title, start_ms: start, children: kids };
        });
      return children.length ? { name: article.title, start_ms: 0, children } : mindmap;
    }
    return mindmap;
  }, [article, chapters, mindmap]);

  const activePara = useMemo(() => {
    for (const ch of reader) {
      const ps = ch.paragraphs;
      for (let i = ps.length - 1; i >= 0; i--) {
        if (current >= ps[i].t) return `${ch.index}-${i}`;
      }
    }
    return "";
  }, [reader, current]);

  const filteredSegments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return viewSegments;
    return viewSegments.filter((s) => s.text.toLowerCase().includes(q));
  }, [viewSegments, search]);

  function seek(ms: number, jump = false) {
    const a = audioRef.current;
    if (a) {
      a.currentTime = ms / 1000;
      setCurrent(ms);
      a.play().catch(() => {});
    } else setCurrent(ms);
    if (!jump) return;
    let idx = segments.findIndex((s) => s.start_ms >= ms);
    if (idx < 0) idx = segments.length - 1;
    const seg = segments[idx];
    if (!seg) return;
    setTab("transcript");
    setSearch("");
    setOpen((prev) => new Set(prev).add(seg.seq));
    setFlashSeq(seg.seq);
    window.setTimeout(() => {
      document.querySelector(`[data-seg="${seg.seq}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 90);
    window.setTimeout(() => setFlashSeq(null), 1800);
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }
  function skip(sec: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec));
  }
  function changeRate() {
    const next = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 2 : rate === 2 ? 0.75 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }
  async function copySummary() {
    if (!shownSummary) return;
    try { await navigator.clipboard.writeText(shownSummary); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }
  function toggleOne(seq: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  }
  const allOpen = segments.length > 0 && open.size >= segments.length;
  function toggleAll() {
    setOpen(allOpen ? new Set() : new Set(segments.map((s) => s.seq)));
  }
  async function reTranscribe() {
    if (!window.confirm("重新誊写会清掉这一期现有的逐字稿与导图，换成新的一份。继续吗？")) return;
    setResetting(true);
    try {
      await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: episode.id, reset: true }),
      });
      setOpen(new Set());
      setStatus("pending");
      setResetNonce((n) => n + 1);
      router.refresh();
    } finally {
      setResetting(false);
    }
  }

  // ---------- 划词存金句 ----------
  useEffect(() => {
    function onUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || text.length < 4 || !sel || sel.rangeCount === 0) { setPicked(null); return; }
      const node = sel.anchorNode?.parentElement;
      const segEl = node?.closest("[data-seg]") as HTMLElement | null;
      if (!segEl) { setPicked(null); return; }
      const segSeq = Number(segEl.dataset.seg);
      const seg = segments.find((s) => s.seq === segSeq);
      if (!seg) { setPicked(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPicked({ text, start_ms: seg.start_ms, x: rect.left + rect.width / 2, y: rect.top });
    }
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, [segments]);

  function savePicked() {
    if (!picked) return;
    onAddHighlight?.({ id: `u-${Date.now()}`, start_ms: picked.start_ms, text: picked.text, note: null, user: true });
    setPicked(null);
    window.getSelection()?.removeAllRanges();
    setTab("essence");
  }

  function copySeg(seg: TranscriptSegment) {
    navigator.clipboard?.writeText(`[${ts(seg.start_ms)}] ${seg.text}`).then(() => {
      setCopiedSeq(seg.seq);
      window.setTimeout(() => setCopiedSeq(null), 1500);
    }).catch(() => {});
  }
  function exportTranscript() {
    const lines = [
      `# ${episode.title}`,
      `${episode.author ?? ""}${episode.duration_sec ? ` · ${fmtDur(episode.duration_sec)}` : ""}`,
      episode.source_url ? `原链接：${episode.source_url}` : "",
      "",
      ...(chapters ?? []).map((c) => `## ${c.title}  [${ts(c.start_ms)}]`),
      "",
      ...viewSegments.map((s) => `[${ts(s.start_ms)}] ${s.text}`),
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${episode.title.slice(0, 24)}-逐字稿.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 实时剩余时间：按已转分钟数推算
  const asrRateRef = useRef<{ t: number; c: number } | null>(null);
  useEffect(() => {
    if (asr?.status === "running" && !asrRateRef.current) asrRateRef.current = { t: Date.now(), c: asr.cursor };
    if (asr?.status !== "running") asrRateRef.current = null;
  }, [asr?.status, asr?.cursor]);

  const etaText = (() => {
    if (!asr || asr.status !== "running" || !asr.total) return "";
    const start = asrRateRef.current;
    if (!start) return "";
    const elapsedMin = (Date.now() - start.t) / 60000;
    const doneMin = (asr.cursor - start.c) / 60;
    if (elapsedMin < 0.15 || doneMin <= 0) return "正在估算…";
    const speed = doneMin / elapsedMin; // 音频分钟 / 墙钟分钟
    const remain = Math.max(0, (asr.total - asr.cursor) / 60);
    const mins = Math.round(remain / Math.max(0.1, speed));
    if (mins <= 0) return "马上完成";
    if (mins >= 60) return `约剩 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
    return `约剩 ${mins} 分钟`;
  })();

  const emptySegments = segments.length === 0;
  const total = asr?.total || episode.duration_sec || 0;
  const pct = total > 0 ? Math.min(99, Math.round(((asr?.cursor ?? 0) / total) * 100)) : 0;
  const statusMeta = emptySegments
    ? { label: asrRunning ? "正在转写…" : "还没有逐字稿", icon: FileText, cls: "pending" }
    : { label: "逐字稿已就绪", icon: CheckCircle2, cls: "ready" };
  const playerProgress = episode.duration_sec ? Math.min(100, (current / 1000 / episode.duration_sec) * 100) : 0;

  const level1 = mindmap?.children ?? [];
  const keyPoints = level1.slice(0, 5);

  return (
    <div className="detail-root">
      {transcribing && (
        <TranscribeDriver
          key={resetNonce}
          episodes={[{ ...episode, transcript_status: status }]}
          onProgress={(p) => {
            const v = p[episode.id];
            if (v && v.totalSec > 0) setTranscribePct(Math.min(99, Math.round((v.cursorSec / v.totalSec) * 100)));
          }}
        />
      )}
      {analyzing && (
        <div className="analyze-bar">
          <div className="ab-top">
            <span className="ab-spin" />
            <strong>正在整理这一期</strong>
            <em>{analyzeSec}s</em>
          </div>
          <div className="ab-steps">
            {["读全文", "切章节", "写文章", "提炼精华"].map((step, i) => (
              <span key={step} className={i < analyzeStep ? "done" : i === analyzeStep ? "now" : ""}>
                {i + 1}. {step}
              </span>
            ))}
          </div>
          <p className="ab-note">大约 60–90 秒，四个环节依次跑完；完成后这一页所有模块会一起更新。</p>
        </div>
      )}

      <div className="detail-deco detail-deco-l" aria-hidden="true" />
      <div className="detail-deco detail-deco-r" aria-hidden="true" />
      <span className="detail-doodle doodle-pine" aria-hidden="true" />
      <span className="detail-doodle doodle-cloud" aria-hidden="true" />
      <span className="detail-doodle doodle-rainbow" aria-hidden="true" />
      <span className="build-tag" title="如果看不到这行，说明浏览器还在用旧的前端包">BUILD 1126-1630</span>
      <header className="detail-topbar">
        <Link href="/dashboard?view=library" className="detail-back"><ChevronLeft size={17} /> 回书斋</Link>
        <div className="detail-top-right">
          <span className="detail-brand"><Headphones size={16} /> Podcast Mantra</span>
        </div>
      </header>

      <div className="detail-wrap">
        {/* 头部：封面 / 标题 / 作者 */}
        <section className="detail-hero sketch-card">
          <div className="detail-cover sketch-tape">
            {displayCover(episode) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayCover(episode) as string} alt="封面" />
            ) : (
              <div className="detail-cover-ph"><Headphones size={44} /></div>
            )}
          </div>
          <div className="detail-hero-info">
            <div className="detail-badges">
              <span className="detail-badge plat">{PLATFORM_LABEL[episode.platform] ?? "其他"}</span>
              {topic && <span className="detail-badge topic" style={{ borderColor: topic.color || "#7d6bab", color: topic.color || "#7d6bab" }}><FolderOpen size={11} />{topic.name}</span>}
              {sample && <span className="detail-badge sample"></span>}
            </div>
            <h1>{episode.title}</h1>
            <div className="detail-meta">
              {episode.author && <span><Headphones size={13} />{episode.author}</span>}
              {episode.episode_no && <span>EP {episode.episode_no}</span>}
              {episode.duration_sec && <span><Clock size={13} />{fmtDur(episode.duration_sec)}</span>}
              {episode.published_at && <span><Calendar size={13} />{fmtDate(episode.published_at)}</span>}
            </div>

            <div className="detail-hero-actions">
              {episode.audio_url ? (
                <button className="hero-play" onClick={togglePlay}>
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                  {playing ? "暂停" : "收听这一期"}
                </button>
              ) : (
                <span className="hero-play ghost"><Loader2 size={14} className="spin" /> 正在取音频…</span>
              )}
              {emptySegments && (
                asrRunning ? (
                  <button className="hero-asr on" onClick={onStopAsr}>
                    <Square size={13} fill="currentColor" /> 停止转写（{pct}%）
                  </button>
                ) : requested ? (
                  <>
                    <span className="hero-asr submitted">已提交申请 · 整理完成后会出现在这里</span>
                    {onStartAsr && (
                      <button className="hero-asr ghost-btn" onClick={onStartAsr} title="不等排队，现在就在这台设备上转写">
                        在本机转写
                      </button>
                    )}
                  </>
                ) : (
                  <button className="hero-asr" onClick={requestTranscribe}>
                    <Wand2 size={15} /> 申请转写
                  </button>
                )
              )}
              {topics && topics.length > 0 && onMoveToAlbum && (
                <label className="hero-move" title="移到别的专辑">
                  <FolderOpen size={13} />
                  <select value={episode.topic_id ?? ""} onChange={(e) => onMoveToAlbum(e.target.value)}>
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              )}
              {episode.source_url && (
                <a className="hero-link" href={episode.source_url} target="_blank" rel="noreferrer">
                  去原平台 <ArrowUpRight size={12} />
                </a>
              )}
            </div>

            <div className="detail-saved">
              <Sparkles size={13} /> 收于 {fmtDate(episode.created_at)} · 声音书斋
            </div>
          </div>
        </section>

        {/* 播放器 */}
        {episode.audio_url && (
          <section className="detail-player sketch-card">
            <audio ref={audioRef} src={episode.audio_url} preload="metadata" onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = rate; }} />
            <div className="player-row">
              <button className="player-btn" onClick={() => skip(-15)} title="后退15秒"><SkipBack size={18} /></button>
              <button className="player-play" onClick={togglePlay}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
              <button className="player-btn" onClick={() => skip(15)} title="前进15秒"><SkipForward size={18} /></button>
              <div className="player-progress" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                const dur = audioRef.current?.duration || episode.duration_sec || 0;
                if (dur) seek(ratio * dur * 1000);
              }}>
                <div className="player-bar"><i style={{ width: `${playerProgress}%` }} /></div>
                <div className="player-times"><span>{ts(current)}</span><span>{episode.duration_sec ? fmtDur(episode.duration_sec) : ""}</span></div>
              </div>
              <button className="player-rate" onClick={changeRate} title="倍速"><Gauge size={14} />{rate}×</button>
              <Volume2 size={17} className="player-vol" />
            </div>
          </section>
        )}

        {/* 转写进度 */}
        {asrRunning && (
          <div className="asr-banner">
            <div className="asr-top">
              <Loader2 size={14} className="spin" />
              <span>{asr?.message && !asr.message.startsWith("正在准备") ? asr.message : `正在转写 ${pct}%…可以先去忙，回来接着看`}</span>
              <em>
                已转 {Math.round((asr?.cursor ?? 0) / 60)} / {Math.round((asr?.total ?? 0) / 60)} 分钟 · {pct}%
                {etaText && <> · {etaText}</>}
              </em>
            </div>
            <div className="asr-bar"><i style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {asr?.status === "error" && asr.message && (
          <div className="asr-banner err"><AlertCircle size={14} /> {asr.message}</div>
        )}

        {/* Tab 栏 */}
        <div className="detail-bar">
          <nav className="detail-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key} role="tab" aria-selected={tab === t.key}
              className={`detail-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={14} /> {t.label}
              {t.key === "transcript" && segments.length > 0 && <em>{segments.length}</em>}
              {t.key === "essence" && (highlights?.length ?? 0) > 0 && <em>{highlights!.length}</em>}
            </button>
          ))}
          </nav>
          {onRetranscribe && segments.length > 0 && (
            <button className="reanalyze-btn" onClick={onRetranscribe} title="清掉旧稿，用当前音频重新转写一遍">
              <RotateCw size={12} /> 重新转写
            </button>
          )}
          {onReanalyze && (
            <button className="reanalyze-btn" onClick={runReanalyze} disabled={reBusy || reanalyzing} title="用当前逐字稿重新生成文章/导图/时间轴/精华">
              {reBusy || reanalyzing ? <><Loader2 size={12} className="spin" /> 整理中…</> : <><RotateCw size={12} /> 重新整理</>}
            </button>
          )}
        </div>
      {reMsg && <p className="re-msg">{reMsg}</p>}

        {/* ========== 知识阅读（默认） ========== */}
        {tab === "knowledge" && article && (
          <article className="ka">
            <header className="ka-head">
              <span className="ka-kicker">KNOWLEDGE · {episode.author ?? ""} · {episode.duration_sec ? fmtDur(episode.duration_sec) : ""}</span>
              <h1 className="ka-title">{article.title}</h1>
              {article.intro && <p className="ka-intro">{article.intro}</p>}
              <div className="ka-meta">
                <span>{article.sections.length} 节</span>
                <span>· 内容来自原音频，可点时间码回听</span>
                {episode.source_url && <a href={episode.source_url} target="_blank" rel="noreferrer">原链接 ↗</a>}
              </div>
            </header>

            {episode.summary && (
              <section className="ka-intro-block">
                <span className="ka-intro-label">节目简介</span>
                <div className="summary-paras">
                  {toParagraphs(episode.summary, 3).map((para, i) => <p key={i} className="summary-text dim">{para}</p>)}
                </div>
              </section>
            )}

            {article.sections.map((sec, i) => (
              <section className="ka-sec" key={sec.id}>
                <div className="ka-sec-head">
                  <span className="ka-num">{String(i + 1).padStart(2, "0")}</span>
                  <h2>{sec.title}</h2>
                </div>
                {sec.summary && <p className="ka-summary">{sec.summary}</p>}
                {sec.content.split(/\n{2,}/).map((para, j) => (
                  <p className="ka-p" key={j}>{para}</p>
                ))}
                <div className="ka-foot">
                  {sec.tags.map((t) => <span className="ka-tag" key={t}>{t}</span>)}
                  {sec.sources.map((src, k) => (
                    <button className="ka-src" key={k} onClick={() => seek(src.start_ms)} title="回到这一段音频">
                      <Clock size={10} /> {ts(src.start_ms)}–{ts(src.end_ms)}
                    </button>
                  ))}
                </div>
              </section>
            ))}

            <p className="quality-note">
              {llmUsed ? "由大模型依据完整逐字稿整理；时间码来自原始 ASR。" : "本地规则整理，结构仅供参考。"}
            </p>
          </article>
        )}

        {/* ========== 导图 ========== */}
        {tab === "mindmap" && (
          <section className="detail-panel sketch-card">
            <div className="panel-head">
              <h2><Network size={17} /> 知识导图</h2>
              <span className="panel-sub">{(mapData?.children?.length ?? level1.length)} 个分支 · 点节点回到原文</span>
            </div>
            {mindmap ? (
              <div className="mm-wrap">
                <MindMap data={mapData ?? mindmap} onSeek={(ms, jump) => seek(ms, jump)} />
              </div>
            ) : (
              <div className="panel-empty">
                <Network size={26} strokeWidth={1.4} />
                <p>还没有导图。</p>
                <p className="dim">转写并整理后，会按知识章节自动生成。</p>
              </div>
            )}
          </section>
        )}

        {/* ========== 时间轴 ========== */}
        {tab === "timeline" && (
          <section className="detail-panel sketch-card">
            <div className="panel-head">
              <h2><Clock size={17} /> 节目时间轴</h2>
              <span className="panel-sub">{timeline.length} 个章节 · 点一下回到那一刻</span>
            </div>
            {timeline.length ? (
              <ol className="tl-list">
                {timeline.map((c, i) => {
                  const active = current >= c.start_ms && (!c.end_ms || current < c.end_ms);
                  return (
                    <li key={c.start_ms} className={`tl-item ${active ? "active" : ""}`}>
                      <button className="tl-time" onClick={() => seek(c.start_ms, true)}>{ts(c.start_ms)}</button>
                      <div className="tl-body">
                        <button className="tl-title" onClick={() => seek(c.start_ms, true)}>{c.title}</button>
                        {c.core && <p>{c.core}</p>}
                        {c.points?.length ? <ul>{c.points.slice(0, 3).map((p, k) => <li key={k}>{p}</li>)}</ul> : null}
                      </div>
                      <span className="tl-span">{ts(c.start_ms)}–{ts(c.end_ms)}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="panel-empty">
                <Clock size={26} strokeWidth={1.4} />
                <p>还没有时间轴。</p>
                <p className="dim">转写并整理后会自动按话题切分章节。</p>
              </div>
            )}
          </section>
        )}

        {/* ========== 概览（没有知识文章时的兜底） ========== */}
        {tab === "knowledge" && !article && (
          <section className="detail-panel sketch-card">
            <div className="panel-head">
              <h2><Sparkles size={17} /> 内容概览</h2>
              <div className="panel-head-actions">
                {onReanalyze && (
                  <button className="transcript-mini" onClick={onReanalyze} disabled={reanalyzing}>
                    {reanalyzing ? <><Loader2 size={11} className="spin" /> 整理中…</> : <><RotateCw size={11} /> 重新整理</>}
                  </button>
                )}
                <span className="panel-sub">{llmUsed ? "大模型整理" : "本地规则整理"}</span>
              </div>
            </div>

            {overview ? (
              <div className="ov">
                <div className="ov-block">
                  <span className="ov-label">A · 一句话</span>
                  <p className="ov-lead">{overview.one_line}</p>
                </div>

                {overview.background.length > 0 && (
                  <div className="ov-block">
                    <span className="ov-label">B · 内容背景</span>
                    {overview.background.map((b, i) => <p key={i} className="ov-text">{b}</p>)}
                  </div>
                )}

                <div className="ov-block">
                  <span className="ov-label">C · 核心内容</span>
                  <ol className="ov-core">
                    {overview.core.map((c) => (
                      <li key={c.title + c.start_ms}>
                        <button className="ov-core-title" onClick={() => seek(c.start_ms, true)}>{c.title}</button>
                        <p>{c.point}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                {overview.conclusion && (
                  <div className="ov-block">
                    <span className="ov-label">D · 主要结论</span>
                    <p className="ov-text">{overview.conclusion}</p>
                  </div>
                )}

                <div className="ov-block">
                  <span className="ov-label">E · 适合谁听</span>
                  <p className="ov-text">{overview.audience}</p>
                </div>
              </div>
            ) : (
              <div className="panel-empty">
                <Sparkles size={26} strokeWidth={1.4} />
                <p>还没有概览。</p>
                <p className="dim">转写完成后，会按「一句话 / 背景 / 核心内容 / 结论 / 适合谁」五段整理；也可以先把逐字稿贴进来。</p>
              </div>
            )}

            <div className="panel-divider" />
            <div className="panel-head"><h2><Info size={17} /> 节目简介</h2></div>
            {episode.summary ? (
              <div className="summary-paras">
                {toParagraphs(episode.summary).map((para, i) => (
                  <p key={i} className="summary-text dim">{para}</p>
                ))}
              </div>
            ) : (
              <p className="summary-text dim">这一期的简介没有留下。{episode.source_url && <a className="inline-link" href={episode.source_url} target="_blank" rel="noreferrer">去原平台看看 ↗</a>}</p>
            )}
            <p className="quality-note">
              {qualityNote || (llmUsed
                ? "由大模型依据完整逐字稿整理。"
                : "当前概览由本地规则抽取，未经大模型改写；在 .env.local 配置 DEEPSEEK_API_KEY 后点「重新整理」即可升级。")}
            </p>
          </section>
        )}

        {/* ========== 逐字稿 ========== */}
        {tab === "transcript" && (
          <section className="detail-panel sketch-card">
            <div className="transcript-head">
              <div>
                <h2><Languages size={18} /> 逐字稿</h2>
                <span className="transcript-sub">
                  <statusMeta.icon size={12} /> {statusMeta.label}
                  {segments.length > 0 && <> · {segments.length} 段</>}
                </span>
              </div>
              <div className="transcript-tools">
                {segments.length > 0 && <button className="transcript-mini" onClick={toggleAll}>{allOpen ? "收起全部" : "展开全部"}</button>}
                {sentences?.length ? (
                  <div className="lang-toggle">
                    <button className={!rawMode ? "active" : ""} onClick={() => setRawMode(false)}>语义断句</button>
                    <button className={rawMode ? "active" : ""} onClick={() => setRawMode(true)}>原始 ASR</button>
                  </div>
                ) : null}
                {segments.length > 0 && (
                  <button className="transcript-mini" onClick={exportTranscript}><Download size={12} /> 导出</button>
                )}
              </div>
            </div>

            {segments.length > 0 && (
              <div className="ts-search">
                <Search size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="在这一期的逐字稿里搜…" />
                {search && <button onClick={() => setSearch("")} aria-label="清除"><X size={13} /></button>}
                {search && <em>{filteredSegments.length} 段命中</em>}
              </div>
            )}

            {(chapters?.length ?? 0) > 0 && search && (
              <div className="chapter-rail">
                {chapters!.map((c) => (
                  <button key={c.start_ms} className="chapter-chip" onClick={() => seek(c.start_ms, true)} title={c.core}>
                    <span className="cc-time">{ts(c.start_ms)}</span>
                    <span className="cc-title">{c.title}</span>
                  </button>
                ))}
              </div>
            )}

            {!search && !emptySegments && (
              <div className="tx-reader">
                <nav className="tx-nav">
                  <span className="tx-nav-title">章节目录</span>
                  {reader.map((ch) => (
                    <button
                      key={ch.index}
                      className={`tx-nav-item ${activePara.startsWith(`${ch.index}-`) ? "on" : ""}`}
                      onClick={() => {
                        seek(ch.start_ms, true);
                        document.querySelector(`[data-ch="${ch.index}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span className="tx-nav-no">{String(ch.index).padStart(2, "0")}</span>
                      <span className="tx-nav-name">{ch.title}</span>
                      <span className="tx-nav-time">{ts(ch.start_ms)}</span>
                    </button>
                  ))}
                </nav>

                <div className="tx-body">
                  {reader.map((ch) => (
                    <section className="tx-ch" key={ch.index} data-ch={ch.index}>
                      <header className="tx-ch-head">
                        <span className="tx-ch-no">CHAPTER {String(ch.index).padStart(2, "0")}</span>
                        <span className="tx-ch-time">{ts(ch.start_ms)} — {ts(ch.end_ms)}</span>
                        <h3>{ch.title}</h3>
                        {ch.summary && <p className="tx-ch-sum">{ch.summary}</p>}
                      </header>
                      {ch.paragraphs.map((para, i) => {
                        const key = `${ch.index}-${i}`;
                        const on = key === activePara;
                        return (
                          <div className={`tx-p ${on ? "on" : ""}`} key={key} id={`p-${key}`}>
                            <button className="tx-p-ts" onClick={() => seek(para.t, true)} title="从这里开始听">{ts(para.t)}</button>
                            <p>{cleanLoops(para.text)}</p>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
              </div>
            )}

            <div className={`transcript-list ${!search && !emptySegments ? "hidden" : ""}`}>
              {emptySegments ? (
                <div className="transcript-empty">
                  <FileText size={26} strokeWidth={1.4} />
                  <p className="te-title">这一期还没有逐字稿。</p>
                  <p>这一期还在整理队列里。可以申请转写，整理完成后所有访客都能看到。</p>
                  <div className="te-actions">
                    {requested ? (
                      <span className="te-requested">已提交申请 · 整理完成后会出现在这里</span>
                    ) : (
                      <button className="te-btn solid" onClick={requestTranscribe}>
                        <Wand2 size={14} /> 申请转写
                      </button>
                    )}
                    {onStartAsr && (
                      <button className="te-btn" onClick={onStartAsr} disabled={asrRunning} title="仅本机试跑，不影响其他访客">
                        {asrRunning ? <><Loader2 size={14} className="spin" /> 正在转写 {pct}%</> : "在本机试转"}
                      </button>
                    )}
                  </div>
                </div>
              ) : filteredSegments.length === 0 ? (
                <div className="transcript-empty">
                  <Search size={24} strokeWidth={1.4} />
                  <p>没搜到「{search}」。</p>
                  <button className="te-btn" onClick={() => setSearch("")}>清掉搜索</button>
                </div>
              ) : filteredSegments.map((seg) => {
                const i = segments.indexOf(seg);
                const isActive = i === activeIdx;
                const isOpen = open.has(seg.seq);
                return (
                  <div
                    key={seg.seq}
                    data-seg={seg.seq}
                    ref={isActive ? activeRef : undefined}
                    className={`seg-item ${isActive ? "active" : ""} ${isOpen ? "open" : ""} ${flashSeq === seg.seq ? "flash" : ""}`}
                  >
                    <div className="seg-head">
                      <button className={`seg-time ${isActive ? "on" : ""}`} onClick={() => seek(seg.start_ms)} title={`从 ${ts(seg.start_ms)} 开始听`}>
                        {ts(seg.start_ms)}
                      </button>
                      <button className="seg-gist" onClick={() => toggleOne(seg.seq)} aria-expanded={isOpen}>
                        <span>{gistOf(seg)}</span>
                        <ChevronDown size={15} className="seg-caret" />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="seg-body">
                        <p className="seg-zh">{seg.text}</p>
                        <div className="seg-actions">
                          <button onClick={() => copySeg(seg)}>{copiedSeq === seg.seq ? <><Check size={11} /> 已复制</> : <><Copy size={11} /> 复制</>}</button>
                          <button onClick={() => onAddHighlight?.({ id: `u-${Date.now()}`, start_ms: seg.start_ms, text: seg.text.slice(0, 120), note: null, user: true })}>
                            <Quote size={11} /> 存为金句
                          </button>
                          <button onClick={() => onAddNote?.(`【${ts(seg.start_ms)}】${seg.text.slice(0, 160)}`)}>
                            <Feather size={11} /> 加进手账
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ========== 精华 ========== */}
        {tab === "essence" && (
          <>
            <section className="detail-panel sketch-card">
              <div className="panel-head">
                <h2><Sparkles size={17} /> 核心观点</h2>
                <span className="panel-sub">{takeaways?.length ?? 0} 条 · 点标题跳回原处</span>
              </div>
              {takeaways?.length ? (
                <div className="ta-list">
                  {takeaways.map((t, i) => (
                    <div className="ta-card" key={`${t.start_ms}-${i}`}>
                      <button className="ta-title" onClick={() => seek(t.start_ms, true)}>
                        <em>{i + 1}</em>{t.title}
                        <span className="ta-time">{ts(t.start_ms)}</span>
                      </button>
                      <p className="ta-explain">{t.explain}</p>
                      {t.evidence && t.evidence !== t.explain && (
                        <p className="ta-evidence"><Quote size={11} /> 依据：{t.evidence.slice(0, 90)}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-empty">
                  <Sparkles size={26} strokeWidth={1.4} />
                  <p>还没有观点。</p>
                  <p className="dim">转写完成后会从逐字稿里挑出有信息量的判断句；接大模型后会更接近「论点 + 论据」。</p>
                </div>
              )}
            </section>

            <section className="detail-panel sketch-card">
              <div className="panel-head">
                <h2><Quote size={17} /> 金句</h2>
                <span className="panel-sub">{(highlights?.length ?? 0) + (quotes?.length ?? 0)} 句 · 选中逐字稿里的句子也能加</span>
              </div>
              {highlights?.length ? (
                <div className="hl-list">
                  {highlights.map((h) => (
                    <div className="hl-item" key={h.id ?? `${h.start_ms}-${h.text.slice(0, 6)}`}>
                      <button className="hl-time" onClick={() => seek(h.start_ms, true)}>{ts(h.start_ms)}</button>
                      <div className="hl-main">
                        <p className="hl-text">「{h.text}」</p>
                        {h.note ? <p className="hl-note"><Feather size={11} /> {h.note}</p> : null}
                        {commentFor === (h.id ?? "") ? (
                          <div className="hl-comment-edit">
                            <textarea className="tp-textarea sm" rows={3} value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="为什么这句值得留下？" />
                            <div className="tp-actions">
                              <button className="tp-ghost" onClick={() => setCommentFor(null)}>取消</button>
                              <button className="tp-save" onClick={() => { onUpdateHighlightNote?.(h.id ?? "", commentDraft.trim()); setCommentFor(null); }}>保存批注</button>
                            </div>
                          </div>
                        ) : (
                          <div className="hl-actions">
                            <button onClick={() => { setCommentFor(h.id ?? ""); setCommentDraft(h.note ?? ""); }}>
                              <Feather size={11} /> {h.note ? "改批注" : "加批注"}
                            </button>
                            {h.user && onRemoveHighlight && (
                              <button onClick={() => onRemoveHighlight(h.id ?? "")}><Trash2 size={11} /> 删除</button>
                            )}
                          </div>
                        )}
                      </div>
                      <button className="hl-play" onClick={() => seek(h.start_ms, true)} aria-label="播放这一句"><Play size={13} /></button>
                    </div>
                  ))}
                </div>
              ) : null}

              {quotes?.length ? (
                <div className="quote-list">
                  {quotes.filter((q) => !(highlights ?? []).some((h) => Math.abs(h.start_ms - q.start_ms) < 1000)).map((q, i) => (
                    <div className="quote-row" key={`${q.start_ms}-${i}`}>
                      <button className="hl-time" onClick={() => seek(q.start_ms, true)}>{ts(q.start_ms)}</button>
                      <p>「{q.text}」</p>
                      <button className="quote-add" onClick={() => onAddHighlight?.({ id: `q-${Date.now()}`, start_ms: q.start_ms, text: q.text, note: null, user: true })} title="收进我的金句">
                        <Plus size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {!highlights?.length && !quotes?.length && (
                <div className="panel-empty">
                  <Quote size={26} strokeWidth={1.4} />
                  <p>还没有金句。</p>
                  <p className="dim">转写后会自动挑几句；更准的做法是去「逐字稿」里划一句，点「存为金句」。</p>
                </div>
              )}
            </section>



            <section className="detail-panel sketch-card">
              <div className="panel-head"><h2><Lightbulb size={17} /> 值得思考的问题</h2></div>
              {questions?.length ? (
                <ol className="q-list">
                  {questions.map((q, i) => {
                    const text = typeof q === "string" ? q : q.q;
                    const why = typeof q === "string" ? "" : q.why;
                    return (
                      <li key={i}>
                        <span className="q-no">{String(i + 1).padStart(2, "0")}</span>
                        <span className="q-text">{text}</span>
                        {why && <em className="q-why">{why}</em>}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="summary-text dim">还没有生成问题。</p>}
              {keywords?.length ? (
                <>
                  <div className="panel-divider" />
                  <div className="panel-head">
                    <h2><Lightbulb size={17} /> 关键主题</h2>
                    <span className="panel-sub">{keywords.length} 个词 · 字号越大越核心</span>
                  </div>
                  <div className="kw-cloud">
                    {keywords
                      .slice()
                      .sort((a, b) => (b.weight ?? 3) - (a.weight ?? 3))
                      .map((k) => {
                        const w = k.weight ?? 3;
                        const kind = k.kind ?? "concept";
                        return (
                          <button
                            key={k.term}
                            className={`kw-word kw-${kind} kw-w${w}`}
                            onClick={() => {
                              setSearch(k.term);
                              setTab("transcript");
                            }}
                            title={k.brief || `在逐字稿里搜索「${k.term}」`}
                          >
                            {k.term}
                          </button>
                        );
                      })}
                  </div>
                  <p className="kw-legend">
                    <span className="kw-word kw-theme kw-w3">主主题</span>
                    <span className="kw-word kw-concept kw-w3">概念</span>
                    <span className="kw-word kw-entity kw-w3">实体</span>
                    <em>点词语跳到逐字稿里搜它</em>
                  </p>
                </>
              ) : null}
            </section>
          </>
        )}

        {/* ========== 关联 ========== */}
        {tab === "related" && (
          <>
            <section className="detail-panel sketch-card">
              <div className="panel-head"><h2><Link2 size={17} /> 相似内容</h2></div>
              {related?.episodes?.length ? (
                <div className="rel-grid">
                  {related.episodes.map((e) => (
                    <Link key={e.id} href={`/episode/${e.id}`} className="rel-card">
                      {displayCover(e) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={displayCover(e) as string} alt="" />
                      ) : <div className="rel-ph"><Headphones size={18} /></div>}
                      <div>
                        <p title={e.title}>{e.title}</p>
                        <span>{e.author ?? ""}{e.duration_sec ? ` · ${fmtDur(e.duration_sec)}` : ""}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : <p className="summary-text dim">还没有相近的内容。多收几期同类的，这里就会连起来。</p>}
            </section>

            <section className="detail-panel sketch-card">
              <div className="panel-head"><h2><FolderOpen size={17} /> 相关专题</h2></div>
              {related?.topics?.length ? (
                <div className="rel-chips">
                  {related.topics.map((t) => (
                    <Link key={t.id} href={`/dashboard?view=grid&topic=${t.id}`} className="rel-chip" style={{ borderColor: t.color || "#7d6bab" }}>
                      <i style={{ background: t.color || "#7d6bab" }} />{t.name}
                    </Link>
                  ))}
                </div>
              ) : <p className="summary-text dim">这一期还没有归到专题里。</p>}
            </section>

            <section className="detail-panel sketch-card">
              <div className="panel-head"><h2><Lightbulb size={17} /> 关联观点</h2></div>
              {related?.sharedKeywords?.length ? (
                <ul className="rel-kw">
                  {related.sharedKeywords.map((k) => (
                    <li key={k.term}>
                      <strong>{k.term}</strong>
                      <span>也在 {k.episodes.length} 期里出现：{k.episodes.slice(0, 2).join("、")}{k.episodes.length > 2 ? "…" : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="summary-text dim">还没有跨期的共同话题。转写几期之后，这里会显出重叠的概念。</p>}
            </section>
          </>
        )}
      </div>

      {/* 划词浮层 */}
      {picked && (
        <button className="pick-pill" style={{ left: picked.x, top: Math.max(12, picked.y - 44) }} onClick={savePicked}>
          <Quote size={12} /> 存为金句
        </button>
      )}
    </div>
  );
}
