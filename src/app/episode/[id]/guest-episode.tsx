"use client";

/**
 * 免登录时的详情页：数据全在浏览器里，识别在本机做。
 *
 * 三层数据合并（近 → 远）：本机逐字稿 > 内置示例稿 > 公共索引。
 * 自动转写是「前端驱动、后端无状态」的：一次请求转一片（默认 4 分钟），
 * 结果立刻落进 localStorage，所以随时关页面、下次接着转。
 */
import type { LocalTranscript } from "@/lib/guest/store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Headphones, Sparkles } from "lucide-react";
import { EpisodeDetail, type AsrState } from "./episode-detail";
import type {
  Episode, Topic, TranscriptSegment, KeywordCard, Highlight, EpisodeNote,
  Chapter, Overview, Takeaway, ActionInsight, ExampleStory, KnowledgeArticle,
} from "@/app/dashboard/types";
import {
  GUEST_SEGMENTS, GUEST_SUMMARY, GUEST_TOPICS, GUEST_EPISODES, DEMO_GUEST_ID, findGuestEpisode,
} from "@/lib/guest/data";
import {
  GUEST_META_KEY, getLocalTranscript, loadGuestLibrary, loadTranscriptMap,
  removeLocalTranscript, saveLocalTranscript, updateGuestEpisode,
  loadNotes, addNote, removeNote, patchLocalTranscript,
  CANONICAL_TOPICS, canonicalTopic,
} from "@/lib/guest/store";
import { transcriptTextToSegments } from "@/lib/guest/transcript";
import { cloudTranscript } from "@/lib/cloud";
import demoAnalysis from "@/data/demo-analysis.json";
import { attachTimecodes, buildMindmapFromSegments, type MindNode } from "@/lib/mindmap";

type EpisodeMeta = { rating?: number; note?: string; topic_id?: string };

function readMeta(id: string): EpisodeMeta {
  try {
    const all = JSON.parse(localStorage.getItem(GUEST_META_KEY) || "{}");
    return all[id] ?? {};
  } catch {
    return {};
  }
}

function firstGist(text: string): string {
  const cut = text.search(/[。！？!?；;，,：:]/);
  const head = cut > 0 ? text.slice(0, cut) : text;
  return head.length > 16 ? `${head.slice(0, 16)}…` : head;
}

function mindmapFor(title: string, segs: TranscriptSegment[]): MindNode | null {
  if (!segs.length) return null;
  const built = buildMindmapFromSegments(title, segs);
  return built ? (attachTimecodes(built, segs) as MindNode) : null;
}

const AUDIO_CACHE_KEY = "pm_audio_cache_v1";
function readAudioCache(id: string): { audio_url?: string; show_cover_url?: string; duration_sec?: number } {
  try {
    const all = JSON.parse(localStorage.getItem(AUDIO_CACHE_KEY) || "{}");
    return all[id] ?? {};
  } catch {
    return {};
  }
}
function writeAudioCache(id: string, patch: Record<string, unknown>) {
  try {
    const all = JSON.parse(localStorage.getItem(AUDIO_CACHE_KEY) || "{}");
    all[id] = { ...(all[id] ?? {}), ...patch };
    localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(all));
  } catch { /* 存不下就只影响这一次 */ }
}

/** 只保留 20 个标准专辑，按名字去重（旧专辑不再出现，避免选择框里重复） */
function canonicalTopics(list: Topic[]): Topic[] {
  const seen = new Map<string, Topic>();
  for (const t of list) {
    const name = CANONICAL_TOPICS.includes(t.name as never) ? t.name : canonicalTopic(t.name);
    if (!seen.has(name)) seen.set(name, { ...t, name });
  }
  // 补齐缺的标准专辑
  for (const name of CANONICAL_TOPICS) {
    if (!seen.has(name)) seen.set(name, { id: `topic-${name}`, name, color: null });
  }
  return [...seen.values()];
}

export function GuestEpisodeView({ id, seed, cloud }: { id: string; seed: Episode | null; cloud?: Record<string, unknown> | null }) {
  const [episode, setEpisode] = useState<Episode | null>(seed ?? findGuestEpisode(id) ?? null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>(() => GUEST_SEGMENTS[id] ?? []);
  const [mindmap, setMindmap] = useState<MindNode | null>(() => {
    const segs = GUEST_SEGMENTS[id] ?? [];
    return segs.length ? mindmapFor(findGuestEpisode(id)?.title ?? "", segs) : null;
  });
  const [keywords, setKeywords] = useState<KeywordCard[] | null>(null);
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [insightSummary, setInsightSummary] = useState<string | null>(null);
  const [asr, setAsr] = useState<AsrState>({ status: "idle", cursor: 0, total: 0 });
  const [notes, setNotes] = useState<EpisodeNote[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [takeaways, setTakeaways] = useState<Takeaway[]>([]);
  const [quotes, setQuotes] = useState<{ text: string; start_ms: number }[]>([]);
  const [actions, setActions] = useState<ActionInsight[]>([]);
  const [examples, setExamples] = useState<ExampleStory[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [llmUsed, setLlmUsed] = useState<boolean | null>(null);
  const [qualityNote, setQualityNote] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [analyzeSec, setAnalyzeSec] = useState(0);
  const [article, setArticle] = useState<KnowledgeArticle | null>(null);
  const [sentences, setSentences] = useState<TranscriptSegment[] | null>(null);
  const [edited, setEdited] = useState<{ chapters: { index: number; title: string; summary: string; start_ms: number; end_ms: number; paragraphs: { t: number; text: string }[] }[] } | null>(null);
  const [summaryOverride, setSummaryOverride] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stopRef = useRef(false);

  const resolve = useCallback((which: string) => {
    const lib = loadGuestLibrary();
    const base =
      lib.episodes.find((e) => e.id === which) ??
      findGuestEpisode(which) ??
      // 云端共享库里的期：服务端已经把元数据取回来了
      (cloud && (cloud.id === which || cloud.episode_id === which)
        ? ({
            id: which,
            title: String(cloud.title ?? "未命名"),
            show: String(cloud.show ?? ""),
            author: String(cloud.author ?? ""),
            platform: String(cloud.platform ?? "xiaoyuzhou"),
            url: String(cloud.source_url ?? ""),
            source_url: String(cloud.source_url ?? ""),
            cover_url: (cloud.cover_url as string) ?? null,
            show_cover_url: (cloud.cover_url as string) ?? null,
            audio_url: (cloud.audio_url as string) ?? null,
            duration_sec: (cloud.duration_sec as number) ?? null,
            published_at: (cloud.published_at as string) ?? null,
            topic_id: null,
            blurb: "",
            theme: (cloud.theme as string) ?? "",
            subtopic: (cloud.subtopic as string) ?? "",
            content_type: (cloud.content_type as string) ?? "",
            audience: (cloud.audience as string) ?? "",
          } as unknown as Episode)
        : null);
    if (!base) {
      // 静态部署时服务端没有数据，浏览器自己向云端取这一期
      void (async () => {
        try {
          const { episode } = await cloudTranscript(which);
          if (!episode) { setEpisode(null); setLoaded(true); return; }
          setEpisode({
            id: which,
            title: episode.title ?? "未命名",
            show: episode.show ?? "",
            author: episode.author ?? "",
            platform: episode.platform ?? "xiaoyuzhou",
            source_url: episode.source_url ?? "",
            cover_url: episode.cover_url ?? null,
            audio_url: episode.audio_url ?? null,
            duration_sec: episode.duration_sec ?? null,
            published_at: episode.published_at ?? null,
            summary: episode.summary ?? null,
          } as unknown as Episode);
          setLoaded(true);
        } catch {
          setEpisode(null);
          setLoaded(true);
        }
      })();
      return;
    }

    const cached = readAudioCache(which);
    const merged = { ...base, ...readMeta(which), ...cached } as Episode;
    const allTopics = [...GUEST_TOPICS, ...lib.topics];
    setEpisode(merged);
    setTopic(allTopics.find((t) => t.id === merged.topic_id) ?? null);

    const stored = getLocalTranscript(which);
    const isSampleId = which === DEMO_GUEST_ID;
    // 示例期自带一份预先算好的分析（章节/概览/观点/金句），打开就有东西看
    const baked = isSampleId && !stored ? (demoAnalysis as unknown as {
      items?: { start_ms: number; end_ms?: number; text: string; gist: string; topic?: string }[];
      chapters?: typeof chapters; overview?: typeof overview; takeaways?: typeof takeaways;
      quotes?: typeof quotes; actions?: typeof actions; examples?: typeof examples;
      questions?: string[]; keywords?: typeof keywords;
      llm?: boolean; quality_note?: string; article?: KnowledgeArticle | null;
    }) : null;

    const segs: TranscriptSegment[] = stored?.segments
      ?? (baked?.items?.length
        ? baked.items.map((p, i) => ({
            seq: i + 1, start_ms: p.start_ms, end_ms: p.end_ms ?? null, speaker: null,
            text: p.text, text_en: null, gist: p.gist, topic: p.topic ?? null,
          }))
        : GUEST_SEGMENTS[which] ?? []);
    setSegments(segs);
    setMindmap(stored?.mindmap ?? mindmapFor(merged.title, segs));
    setKeywords(stored?.keywords ?? baked?.keywords ?? null);
    setHighlights(stored?.highlights ?? null);
    setInsightSummary(stored?.summary ?? null);
    setSummaryOverride(stored?.summary_override ?? null);
    setNotes(loadNotes(which));
    setChapters(stored?.chapters ?? baked?.chapters ?? []);
    setOverview(stored?.overview ?? baked?.overview ?? null);
    setTakeaways(stored?.takeaways ?? baked?.takeaways ?? []);
    setQuotes(stored?.quotes ?? baked?.quotes ?? []);
    setActions(stored?.actions ?? baked?.actions ?? []);
    setExamples(stored?.examples ?? baked?.examples ?? []);
    setQuestions(stored?.questions ?? baked?.questions ?? []);
    setArticle(stored?.article ?? baked?.article ?? null);
    setSentences(stored?.sentences ?? null);
    setEdited((stored?.edited_transcript as typeof edited) ?? null);
    setLlmUsed(stored?.llm ?? baked?.llm ?? null);
    setQualityNote(stored?.quality_note ?? baked?.quality_note ?? null);
    setAsr({
      status: "idle",
      cursor: stored?.cursor_sec ?? 0,
      total: stored?.total_sec ?? merged.duration_sec ?? 0,
    });
    setLoaded(true);

    // 本地没有 → 去云端取共享成品（这是别人整理好的那一份）
    if (!stored) {
      void (async () => {
        try {
          const j = await cloudTranscript(which).then((r) => ({ found: !!r.transcript, ...r }));
          if (!j?.found) return;
          const t = (j.transcript ?? {}) as Record<string, any>;
          if (Array.isArray(t.segments) && t.segments.length) setSegments(t.segments);
          if (t.article) setArticle(t.article);
          if (t.edited) setEdited(t.edited);
          if (Array.isArray(t.chapters)) setChapters(t.chapters);
          if (Array.isArray(t.insights) && t.insights.length) {
            setTakeaways((t.insights as { title: string; content: string; start_ms: number; raw?: string }[]).map((x) => ({
              title: x.title, explain: x.content, evidence: x.raw ?? "", start_ms: x.start_ms,
            })));
          }
          if (t.mindmap) setMindmap(t.mindmap);
          setLlmUsed(Boolean(t.llm));
          setQualityNote(t.quality_note ?? "来自共享知识库");
        } catch { /* 云端不可用时保持本地空态 */ }
      })();
    }
  }, []);

  useEffect(() => { resolve(id); }, [id, resolve]);

  // 自愈：逐字稿有了、整理结果还没有 → 自动在后台跑一次
  const autoAnalyzed = useRef(false);
  useEffect(() => {
    if (!loaded || autoAnalyzed.current) return;
    if (isSample || !segments.length) return;
    const hasAnalysis = Boolean(article) || (takeaways?.length ?? 0) > 0 || (chapters?.length ?? 0) > 0;
    if (hasAnalysis) return;
    autoAnalyzed.current = true;
    void finishAnalysis(segments, asr?.total || episode?.duration_sec || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, segments.length, article, takeaways, chapters]);

  const isLocal = useMemo(() => id.startsWith("guest-local-"), [id]);
  const isSample = id === DEMO_GUEST_ID;
  // 示例期有一份策划过的摘要，优先用它；普通期用清单里的简介
  const summary = GUEST_SUMMARY[id] || episode?.summary || null;

  // 打开一期时不再自动转写：有数据就渲染，没有就提示"正在整理"，
  // 由访客点「申请转写」，或你本地点「在本机试转」。



  function handleSaveTranscript(text: string) {
    if (!episode) return;
    const segs = transcriptTextToSegments(text, episode.duration_sec ?? null);
    if (!segs.length) return;
    const mm = mindmapFor(episode.title, segs);
    saveLocalTranscript(id, segs, mm, { source: "paste" });
    if (isLocal) updateGuestEpisode(id, { transcript_status: "ready" });
    setSegments(segs);
    setMindmap(mm);
    setKeywords(null);
    setHighlights(null);
  }

  function handleClearTranscript() {
    removeLocalTranscript(id);
    const segs = GUEST_SEGMENTS[id] ?? [];
    setSegments(segs);
    setMindmap(mindmapFor(episode?.title ?? "", segs));
    setKeywords(null);
    setHighlights(null);
    setInsightSummary(null);
    setAsr({ status: "idle", cursor: 0, total: episode?.duration_sec ?? 0 });
  }

  /** 清单里没有音频直链时，进页面顺手补一条（并缓存） */
  const hydrateAudio = useCallback(async () => {
    if (!episode?.source_url) return;
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: episode.source_url }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const d = json.data ?? {};
      const patch = {
        audio_url: d.audio_url ?? null,
        show_cover_url: d.show?.cover_url ?? null,
        duration_sec: d.duration_sec ?? null,
      };
      if (!patch.audio_url) return;
      writeAudioCache(id, patch);
      setEpisode((ep) => (ep ? { ...ep, ...patch } : ep));
    } catch { /* 补不到就继续没有播放器 */ }
  }, [episode?.source_url, id]);

  /** 自动转写：循环请求，一次一片，进度与结果都落在本机 */
  /** 重新转写：清掉旧稿（含旧的整理结果），从头再跑一遍 */
  async function retranscribe() {
    if (!window.confirm("重新转写会覆盖这一期现有的逐字稿和整理结果，确定吗？")) return;
    try { removeLocalTranscript(id); } catch { /* 忽略 */ }
    setSegments([]);
    setArticle(null);
    setChapters([]);
    setOverview(null);
    setTakeaways([]);
    setQuotes([]);
    setEdited(null);
    setAsr({ status: "idle", cursor: 0, total: episode?.duration_sec ?? 0 });
    await startAsr();
  }

  async function startAsr() {
    if (!episode) return;
    let audioUrl = episode.audio_url;
    if (!audioUrl) {
      await hydrateAudio();
      const cached = readAudioCache(id).audio_url;
      audioUrl = cached ?? undefined;
      if (!audioUrl) {
        setAsr({ status: "error", cursor: 0, total: 0, message: "这一期没有可用的音频直链，暂时没法自动转写。" });
        return;
      }
    }

    stopRef.current = false;
    const total = episode.duration_sec ?? 0;
    const existing = getLocalTranscript(id);
    let cursor = existing?.segments?.length ? (existing.cursor_sec ?? 0) : 0;
    let acc: TranscriptSegment[] = existing?.segments?.length ? existing.segments : [];

    setAsr({ status: "running", cursor, total, message: "正在准备…" });

    let guard = 0;
    while (!stopRef.current && guard < 400) {
      guard += 1;
      let json: {
        status?: string; cursor_sec?: number; total_sec?: number;
        segments?: TranscriptSegment[]; message?: string;
      };
      // 单片失败（超时 / 服务重启）自动重试，别让整期停在中途
      let attempt = 0;
      while (true) {
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio_url: audioUrl, title: episode.title, cursor_sec: cursor, total_sec: total }),
          });
          json = await res.json();
          break;
        } catch {
          attempt += 1;
          if (attempt > 3) {
            setAsr({
              status: "error", cursor, total,
              message: `这一段没转成功（已重试 3 次）。已经转好的部分都在，点「继续转写」会从这里接着来。`,
            });
            return;
          }
          setAsr({ status: "running", cursor, total, message: `这一片超时了，正在重试（${attempt}/3）…` });
          await new Promise((r) => setTimeout(r, 2500));
        }
      }

      if (json.status === "loading") {
        setAsr({ status: "running", cursor, total, message: json.message ?? "正在加载本地模型…" });
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (json.status === "need_env" || json.status === "no_audio" || json.status === "error") {
        setAsr({ status: "error", cursor, total, message: json.message ?? "转写没能继续" });
        return;
      }

      const fresh = json.segments ?? [];
      if (fresh.length) {
        const seen = new Set(acc.map((s) => s.start_ms));
        acc = [...acc, ...fresh.filter((s) => !seen.has(s.start_ms))].sort((a, b) => a.start_ms - b.start_ms);
        const mm = mindmapFor(episode.title, acc);
        saveLocalTranscript(id, acc, mm, { source: "asr", cursor_sec: json.cursor_sec ?? cursor, total_sec: total });
        setSegments(acc);
        setMindmap(mm);
      }
      cursor = json.cursor_sec ?? cursor;
      setAsr({ status: "running", cursor, total });

      if (json.status === "done") {
        await finishAnalysis(acc, total);
        return;
      }
    }

    if (stopRef.current) setAsr({ status: "idle", cursor, total });
  }

  async function finishAnalysis(segs: TranscriptSegment[], total: number) {
    const payload = segs.map((x) => ({ start_ms: x.start_ms, text: x.text }));

    // 交给服务端后台跑：页面关掉也继续，回来照样有结果
    try {
      await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episode_id: id,
          title: episode?.title ?? "",
          segments: payload,
          episode: {
            title: episode?.title ?? "",
            show: (episode as unknown as { show?: string })?.show ?? "",
            author: episode?.author ?? "",
            cover_url: episode?.cover_url ?? null,
            audio_url: episode?.audio_url ?? null,
            duration_sec: episode?.duration_sec ?? null,
            published_at: episode?.published_at ?? null,
            source_url: episode?.source_url ?? null,
            platform: episode?.platform ?? "unknown",
            theme: (episode as unknown as { theme?: string })?.theme ?? null,
            subtopic: (episode as unknown as { subtopic?: string })?.subtopic ?? null,
            content_type: (episode as unknown as { content_type?: string })?.content_type ?? null,
            audience: (episode as unknown as { audience?: string })?.audience ?? null,
          },
        }),
      });
    } catch { /* 起不来就走下面的同步路径 */ }

    setAsr({ status: "running", cursor: total, total, message: "正在后台整理…可以关掉页面，稍后回来看" });

    const startedAt = Date.now();
    let json: any = null;
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const sec = Math.round((Date.now() - startedAt) / 1000);
      setAsr({
        status: "running",
        cursor: total,
        total,
        message: `正在后台整理…已用 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒`,
      });
      try {
        const r = await fetch(`/api/analyze-job?episode_id=${encodeURIComponent(id)}`);
        const j = await r.json();
        if (!j?.found) continue;
        if (j.status === "done") { json = j.result; break; }
        if (j.status === "error") {
          setAsr({ status: "error", cursor: total, total, message: `整理失败：${j.error ?? "未知原因"}` });
          return;
        }
      } catch { /* 网络抖动继续轮询 */ }
      if (Date.now() - startedAt > 45 * 60 * 1000) {
        setAsr({ status: "error", cursor: total, total, message: "整理超时，稍后可用「重新整理」继续" });
        return;
      }
    }

    // 把结果落进本机
    try {
      const sem = json?.segments as { start_ms: number; text: string }[] | undefined;
      const semSegs: TranscriptSegment[] | null = sem?.length
        ? sem.map((p, i) => ({
            seq: i + 1, start_ms: p.start_ms, end_ms: null, speaker: null,
            text: p.text, text_en: null, gist: firstGist(p.text), topic: null,
          }))
        : null;
      const merged: TranscriptSegment[] = segs;
      const mm = (json?.mindmap as MindNode | null) ?? mindmapFor(episode?.title ?? "", semSegs ?? merged);
      const finalMap = mm ? (attachTimecodes(mm, merged) as MindNode) : null;

      saveLocalTranscript(id, merged, finalMap, {
        source: "asr",
        cursor_sec: total,
        total_sec: total,
        summary: json?.summary ?? null,
        keywords: json?.keywords ?? null,
        highlights: json?.highlights ?? null,
        article: json?.article ?? null,
        edited_transcript: (json as { edited_transcript?: LocalTranscript["edited_transcript"] })?.edited_transcript ?? null,
        sentences: semSegs,
        chapters: json?.chapters ?? [],
        overview: json?.overview ?? null,
        takeaways: json?.takeaways ?? [],
        quotes: json?.quotes ?? [],
        actions: json?.actions ?? [],
        examples: json?.examples ?? [],
        questions: json?.questions ?? [],
      });
      setArticle(json?.article ?? null);
      setEdited((json as { edited_transcript?: typeof edited })?.edited_transcript ?? null);
      setChapters(json?.chapters ?? []);
      setOverview(json?.overview ?? null);
      setTakeaways(json?.takeaways ?? []);
      setQuotes(json?.quotes ?? []);
      setKeywords(json?.keywords ?? null);
      setMindmap(finalMap);
      setAsr({ status: "done", cursor: total, total, message: "整理完成" });
      if (isLocal) updateGuestEpisode(id, { transcript_status: "ready" });
      setAsr({ status: "done", cursor: total, total });
    } catch {
      setAsr({ status: "done", cursor: total, total, message: "逐字稿已齐，整理这一步没成功。" });
    }
  }

  /** 用当前配置（有 key 就是大模型）把这一期重新整理一遍 */
  async function reanalyze() {
    setAnalyzeStep(1);
    setAnalyzeSec(0);
    console.log("[reanalyze] 点击了，segments =", segments.length, "reanalyzing =", reanalyzing);
    if (!segments.length) {
      setQualityNote("这一期还没有逐字稿，先转写再整理。");
      return;
    }
    if (reanalyzing) {
      setQualityNote("正在整理中，请稍候…");
      return;
    }
    setQualityNote("已提交整理请求，正在生成…");
    // 进度条在页面顶部，滚上去让用户立刻看到反馈
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* 忽略 */ }
    setReanalyzing(true);
    const tick = window.setInterval(() => setAnalyzeSec((x) => x + 1), 1000);
    const steps = window.setInterval(() => setAnalyzeStep((x) => Math.min(4, x + 1)), 16000);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: episode?.title ?? "",
          segments: segments.map((s) => ({ start_ms: s.start_ms, text: s.text })),
        }),
      });
      const json = await res.json();
      if (json.status !== "ok") { setQualityNote(json.message ?? "整理失败"); return; }
      const sem = json.segments as { start_ms: number; text: string }[] | undefined;
      const semSegs: TranscriptSegment[] | null = sem?.length
        ? sem.map((p, i) => ({
            seq: i + 1, start_ms: p.start_ms, end_ms: null, speaker: null,
            text: p.text, text_en: null, gist: firstGist(p.text), topic: null,
          }))
        : null;
      const merged = segments;
      const mm = (json.mindmap as MindNode | null) ?? mindmap;
      const finalMap = mm ? (attachTimecodes(mm, merged) as MindNode) : null;
      saveLocalTranscript(id, merged, finalMap, {
        source: "asr",
        cursor_sec: total_sec(id),
        total_sec: total_sec(id),
        summary: json.summary ?? null,
        keywords: json.keywords ?? null,
        highlights: json.highlights ?? null,
        chapters: json.chapters ?? [],
        overview: json.overview ?? null,
        takeaways: json.takeaways ?? [],
        quotes: json.quotes ?? [],
        actions: json.actions ?? [],
        examples: json.examples ?? [],
        questions: json.questions ?? [],
        article: json.article ?? null,
        edited_transcript: (json as { edited_transcript?: LocalTranscript["edited_transcript"] }).edited_transcript ?? null,
        sentences: semSegs,
        llm: !!json.llm,
        quality_note: json.quality_note ?? null,
      });
      setSegments(merged);
      setSentences(semSegs);
      setEdited((json as { edited_transcript?: typeof edited }).edited_transcript ?? null);
      setArticle(json.article ?? null);
      setMindmap(finalMap);
      setKeywords(json.keywords ?? null);
      setHighlights(json.highlights ?? null);
      setInsightSummary(json.summary ?? null);
      setChapters(json.chapters ?? []);
      setOverview(json.overview ?? null);
      setTakeaways(json.takeaways ?? []);
      setQuotes(json.quotes ?? []);
      setActions(json.actions ?? []);
      setExamples(json.examples ?? []);
      setQuestions(json.questions ?? []);
      setLlmUsed(!!json.llm);
      setQualityNote(json.quality_note ?? null);
    } catch (e) {
      console.error("[reanalyze] 失败", e);
      setQualityNote(`整理失败：${e instanceof Error ? e.message : "请求出错"}，请稍后重试。`);
    } finally {
      window.clearInterval(tick);
      window.clearInterval(steps);
      setReanalyzing(false);
      setAnalyzeStep(0);
    }
  }

  function total_sec(which: string) {
    return getLocalTranscript(which)?.total_sec ?? episode?.duration_sec ?? 0;
  }

  function handleSaveSummary(text: string | null) {
    patchLocalTranscript(id, { summary_override: text });
    setSummaryOverride(text);
  }

  function handleAddHighlight(h: Highlight) {
    const cur = highlights ?? [];
    const next = [{ ...h, id: h.id ?? `u-${Date.now()}` }, ...cur];
    setHighlights(next);
    patchLocalTranscript(id, { highlights: next });
  }

  function handleUpdateHighlightNote(hid: string, note: string) {
    const next = (highlights ?? []).map((h) => (h.id === hid ? { ...h, note } : h));
    setHighlights(next);
    patchLocalTranscript(id, { highlights: next });
  }

  function handleRemoveHighlight(hid: string) {
    const next = (highlights ?? []).filter((h) => h.id !== hid);
    setHighlights(next);
    patchLocalTranscript(id, { highlights: next });
  }

  function handleAddNote(text: string) {
    setNotes(addNote(id, text));
  }
  function handleRemoveNote(nid: string) {
    setNotes(removeNote(id, nid));
  }
  function handleMoveToAlbum(topicId: string) {
    if (!topicId || !episode) return;
    if (isLocal) updateGuestEpisode(id, { topic_id: topicId });
    // 公共索引的期：写进 pm_episode_meta
    try {
      const all = JSON.parse(localStorage.getItem(GUEST_META_KEY) || "{}");
      all[id] = { ...(all[id] ?? {}), topic_id: topicId };
      localStorage.setItem(GUEST_META_KEY, JSON.stringify(all));
    } catch { /* 存不下只影响这一次 */ }
    setEpisode((ep) => (ep ? { ...ep, topic_id: topicId } : ep));
    const allTopics = [...GUEST_TOPICS, ...loadGuestLibrary().topics];
    setTopic(allTopics.find((t) => t.id === topicId) ?? null);
  }

  function stopAsr() {
    stopRef.current = true;
    setAsr((s) => ({ ...s, status: "idle" }));
  }

  if (!loaded) {
    return <div className="gld-root"><p className="gld-loading"><Sparkles size={15} /> 正在翻这一页…</p></div>;
  }

  if (!episode) {
    return (
      <div className="gld-root">
        <Link href="/dashboard" className="gld-back"><ArrowLeft size={15} /> 回书斋</Link>
        <div className="gld-card">
          <h1>这一期不在这台设备上</h1>
          <p>书斋是「本机优先」的：自己粘进来的那期只保存在当时用的浏览器里。换设备或清过缓存，就找不回来了。</p>
          <p className="gld-tip">想让它跟你走，把链接再粘一次就好。</p>
          <Link href="/dashboard" className="gld-primary"><Headphones size={15} /> 回书斋重新收一条</Link>
        </div>
      </div>
    );
  }

  // 关联：同一档节目 / 同一个专辑 / 共用关键词的期
  const related = (() => {
    if (!episode) return null;
    const lib = loadGuestLibrary();
    const allEpisodes = [...lib.episodes, ...GUEST_EPISODES];
    const map = loadTranscriptMap();
    const mine = new Set((keywords ?? []).map((k) => k.term));
    const shared = new Map<string, string[]>();
    for (const [epId, t] of Object.entries(map)) {
      if (epId === id || !t.keywords) continue;
      const other = allEpisodes.find((e) => e.id === epId);
      if (!other) continue;
      for (const k of t.keywords) {
        if (!mine.has(k.term)) continue;
        shared.set(k.term, [...(shared.get(k.term) ?? []), other.title.slice(0, 18)]);
      }
    }
    const similar = allEpisodes
      .filter((e) => e.id !== id && (e.show_id === episode.show_id || (e.topic_id && e.topic_id === episode.topic_id)))
      .slice(0, 4);
    const relTopics = [...GUEST_TOPICS, ...lib.topics].filter((t) => t.id === episode.topic_id);
    return {
      episodes: similar,
      topics: relTopics,
      sharedKeywords: [...shared.entries()].map(([term, eps]) => ({ term, episodes: eps })).slice(0, 6),
    };
  })();

  return (
    <EpisodeDetail
      episode={episode}
      topic={topic}
      segments={segments}
      summary={summaryOverride ?? summary}
      mindmap={mindmap}
      isDemo={false}
      sample={isSample}
      local={!isSample}
      onSaveTranscript={isSample ? undefined : handleSaveTranscript}
      onClearTranscript={isSample ? undefined : handleClearTranscript}
      keywords={keywords}
      highlights={highlights}
      insightSummary={insightSummary}
      asr={asr}
      onStartAsr={isSample ? undefined : startAsr}
      onRetranscribe={isSample ? undefined : retranscribe}
      onStopAsr={stopAsr}
      onHydrateAudio={hydrateAudio}
      notes={notes}
      onAddNote={isSample ? undefined : handleAddNote}
      onRemoveNote={isSample ? undefined : handleRemoveNote}
      onSaveSummary={isSample ? undefined : handleSaveSummary}
      onAddHighlight={isSample ? undefined : handleAddHighlight}
      onUpdateHighlightNote={isSample ? undefined : handleUpdateHighlightNote}
      onRemoveHighlight={isSample ? undefined : handleRemoveHighlight}
      related={related}
      llmUsed={llmUsed}
      qualityNote={qualityNote}
      reanalyzing={reanalyzing}
      analyzing={reanalyzing}
      analyzeSec={analyzeSec}
      analyzeStep={analyzeStep}
      onReanalyze={isSample ? undefined : reanalyze}
      article={article}
      sentences={sentences}
      edited={edited}
      chapters={chapters}
      overview={overview}
      takeaways={takeaways}
      quotes={quotes}
      actions={actions}
      examples={examples}
      questions={questions}
      topics={canonicalTopics(GUEST_TOPICS.concat(loadGuestLibrary().topics))}
      onMoveToAlbum={isSample ? undefined : handleMoveToAlbum}
    />
  );
}
