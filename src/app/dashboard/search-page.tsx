"use client";

/**
 * 全局搜索：本机内容 + 公共推荐池一起搜。
 * 不会、也没有能力搜互联网——这一点在页面上写明。
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search, X, Headphones, FileText, Sparkles, Feather, Disc3, ArrowUpRight, SlidersHorizontal,
} from "lucide-react";
import type { Episode, Topic } from "./types";
import { displayCover } from "@/lib/guest/data";
import { loadTranscriptMap, loadNotes, loadGuestLibrary, loadHiddenEpisodes } from "@/lib/guest/store";
import type { EpisodeNote, Highlight } from "./types";
import { REC_ITEMS, TOPICS } from "@/lib/recommend";

type Scope = "mine" | "public";
type Sort = "relevance" | "time";

const STOP = new Set([
  "我们","他们","你们","这个","那个","一个","什么","怎么","可以","就是","还有","不是","没有","自己",
  "这一","那一","本期","节目","这期","期节","时候","因为","所以","但是","如果","已经","现在","知道",
  "这样","那样","一下","一些","这些","那些","非常","真的","其实","然后","而是","以及","或者","一直",
]);

/** 从真实标题里抽高频 2–4 字词，保证「试试」点下去一定有结果 */
function deriveKeywords(titles: string[], n = 6): string[] {
  const freq = new Map<string, number>();
  for (const t of titles) {
    const clean = t.replace(/[\s\p{P}\p{S}]/gu, "");
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i + len <= clean.length; i++) {
        const g = clean.slice(i, i + len);
        if (STOP.has(g)) continue;
        if (!/^[\u4e00-\u9fa5]{2,4}$/.test(g)) continue;
        freq.set(g, (freq.get(g) ?? 0) + 1);
      }
    }
  }
  // 同一句话会被切出很多重叠的片段（随机 / 机波 / 随机波…），
  // 按"频次 × 词长"排序后做一次包含去重，只留最有代表性的说法。
  const ranked = [...freq.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);

  const picked: string[] = [];
  for (const [g] of ranked) {
    if (picked.some((p) => p.includes(g) || g.includes(p))) continue;
    picked.push(g);
    if (picked.length >= n) break;
  }
  return picked;
}

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}
function fmtDate(s: string | null) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function SearchPage({ episodes, topics, transcriptIds, onOpenEpisode }: {
  episodes: Episode[];
  topics: Topic[];
  transcriptIds: Set<string>;
  onOpenEpisode?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("mine");
  const [sort, setSort] = useState<Sort>("relevance");
  const [status, setStatus] = useState<"all" | "ready" | "pending">("all");
  const [platform, setPlatform] = useState<string>("all");
  const [theme, setTheme] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hidden = useMemo(() => new Set(loadHiddenEpisodes()), []);
  const transcripts = useMemo(() => loadTranscriptMap(), []);
  const notesByEp = useMemo(() => {
    const out: Record<string, EpisodeNote[]> = {};
    episodes.forEach((e) => { out[e.id] = loadNotes(e.id); });
    return out;
  }, [episodes]);
  const localLib = useMemo(() => loadGuestLibrary(), []);

  // 公共池的主题/栏目也参与检索，主题词才点得动
  const metaByEp = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of REC_ITEMS) m.set(r.episode.id, `${r.theme} ${r.topic}`);
    return m;
  }, []);

  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: Episode[] = [];
    for (const e of episodes) {
      if (hidden.has(e.id) || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
    for (const r of REC_ITEMS) {
      if (seen.has(r.episode.id)) continue;
      seen.add(r.episode.id);
      out.push(r.episode);
    }
    return out;
  }, [episodes, hidden]);

  const term = q.trim().toLowerCase();

  const themedHits = useMemo(
    () => (theme ? REC_ITEMS.filter((r) => r.theme === theme).map((r) => r.episode) : []),
    [theme]
  );

  const contentHits = useMemo(() => {
    if (theme) {
      return themedHits.filter((e) => {
        if (status === "ready" && !transcriptIds.has(e.id)) return false;
        if (status === "pending" && transcriptIds.has(e.id)) return false;
        if (platform !== "all" && e.platform !== platform) return false;
        return true;
      });
    }
    if (!term) return [];
    return pool.filter((e) => {
      if (status === "ready" && !transcriptIds.has(e.id)) return false;
      if (status === "pending" && transcriptIds.has(e.id)) return false;
      if (platform !== "all" && e.platform !== platform) return false;
      const hay = `${e.title} ${e.author ?? ""} ${e.summary ?? ""} ${metaByEp.get(e.id) ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [pool, term, status, platform, transcriptIds]);

  const transcriptHits = useMemo(() => {
    if (!term || theme) return [];
    const out: { ep: Episode; start_ms: number; text: string }[] = [];
    for (const [epId, t] of Object.entries(transcripts)) {
      const ep = episodes.find((e) => e.id === epId);
      if (!ep) continue;
      for (const s of t.segments ?? []) {
        if (s.text.toLowerCase().includes(term)) out.push({ ep, start_ms: s.start_ms, text: s.text });
        if (out.length > 200) break;
      }
    }
    return out.slice(0, 12);
  }, [term, transcripts, episodes, scope]);

  const essenceHits = useMemo(() => {
    if (!term || theme) return [];
    const out: { ep: Episode; kind: string; text: string; start_ms: number }[] = [];
    for (const [epId, t] of Object.entries(transcripts)) {
      const ep = episodes.find((e) => e.id === epId);
      if (!ep) continue;
      for (const h of (t.highlights ?? []) as Highlight[]) {
        if (h.text.toLowerCase().includes(term)) out.push({ ep, kind: "金句", text: h.text, start_ms: h.start_ms });
      }
      for (const k of t.keywords ?? []) {
        if (k.term.toLowerCase().includes(term)) out.push({ ep, kind: "关键词", text: `${k.term}：${k.brief}`, start_ms: 0 });
      }
      for (const x of t.takeaways ?? []) {
        if (x.title.toLowerCase().includes(term)) out.push({ ep, kind: "观点", text: `${x.title} — ${x.explain}`, start_ms: x.start_ms });
      }
    }
    return out.slice(0, 10);
  }, [term, transcripts, episodes, scope]);

  const noteHits = useMemo(() => {
    if (!term || theme) return [];
    const out: { ep: Episode; note: EpisodeNote }[] = [];
    for (const [epId, list] of Object.entries(notesByEp)) {
      const ep = episodes.find((e) => e.id === epId);
      if (!ep) continue;
      for (const n of list) if (n.text.toLowerCase().includes(term)) out.push({ ep, note: n });
    }
    return out.slice(0, 8);
  }, [term, notesByEp, episodes, scope]);

  const albumHits = useMemo(() => {
    if (!term) return [];
    return topics.filter((t) => t.name.toLowerCase().includes(term));
  }, [term, topics]);

  const sortedContent = useMemo(() => {
    const list = [...contentHits];
    if (sort === "time") {
      list.sort((a, b) => new Date(b.added_at || b.created_at).getTime() - new Date(a.added_at || a.created_at).getTime());
    }
    return list;
  }, [contentHits, sort]);

  const total = sortedContent.length + transcriptHits.length + essenceHits.length + noteHits.length + albumHits.length;
  const publicPool = useMemo(() => REC_ITEMS, []);

  // 「试试」= 公共池里真实的栏目词（点下去一定命中）
  const keywords = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of REC_ITEMS) {
      const t = (r.topic || "").trim();
      if (!t || t.length > 8) continue;
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  }, []);


  const themeStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of REC_ITEMS) m.set(r.theme, (m.get(r.theme) ?? 0) + 1);
    return [...m.entries()]
      .filter(([name]) => name && name !== "未分类")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, []);

  const albumList = useMemo(
    () => topics
      .map((t) => {
        const list = episodes.filter((e) => e.topic_id === t.id);
        const cover = list.length ? displayCover(list[0]) : null;
        return { ...t, count: list.length, cover };
      })
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    [topics, episodes]
  );

  const active = Boolean(term) || Boolean(theme);

  function runSearch(text: string) {
    setTheme(null);
    setQ(text);
    inputRef.current?.focus();
  }
  function openTheme(name: string) {
    setQ("");
    setScope("public");
    setTheme(name);
  }

  return (
    <div className="search-page">
      <div className="search-deco search-deco-l" aria-hidden="true" />
      <div className="search-deco search-deco-r" aria-hidden="true" />
      <header className="search-head">
        <h1 className="search-title tri">
          <span className="tri-a">从念起</span>
          <span className="tri-sep">，</span>
          <span className="tri-b">到心定</span>
          <span className="tri-sep">，</span>
          <span className="tri-c">再到显化</span>
          <span className="tri-dot">。</span>
        </h1>
        <p className="search-sub">From thought, to belief, to becoming.</p>
        <div className="search-bar">
          <Search size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、作者、逐字稿、观点、金句或笔记"
            autoFocus
          />
          {q && <button className="search-clear" onClick={() => { setQ(""); inputRef.current?.focus(); }}><X size={15} /></button>}
        </div>



        {!active && (
          <div className="explore">
            <section className="ex-block">
              <div className="ex-head"><h3>试试</h3><span>TRY SEARCHING</span></div>
              <div className="ex-keys">
                {keywords.map((k) => (
                  <button key={k} className="ex-key" onClick={() => runSearch(k)}>
                    <Search size={11} /> {k}
                  </button>
                ))}
              </div>
            </section>

            <section className="ex-block">
              <div className="ex-head"><h3>热门主题</h3><span>POPULAR TOPICS</span></div>
              <div className="ex-themes">
                {themeStats.map((t, i) => (
                  <button key={t.name} className="ex-theme" onClick={() => openTheme(t.name)}>
                    <em>{String(i + 1).padStart(2, "0")}</em>
                    <strong>{t.name}</strong>
                    <span>{t.count}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="ex-block">
              <div className="ex-head"><h3>精选专辑</h3><span>FEATURED COLLECTIONS</span></div>
              <div className="ex-cards">
                {albumList.map((a) => (
                  <Link key={a.id} href={`/dashboard?album=${a.id}`} className="ex-card">
                    <span className="ec-photo">
                      {a.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.cover} alt="" />
                      ) : <Disc3 size={22} />}
                    </span>
                    <span className="ec-veil" />
                    <span className="ec-body">
                      <strong>{a.name}</strong>
                      <em>{a.count} 期</em>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}

      </header>

      {theme && (
        <div className="theme-bar">
          <span>主题 · <strong>{theme}</strong> · {themedHits.length} 期</span>
          <button onClick={() => setTheme(null)}>清除 <X size={12} /></button>
        </div>
      )}

      {active && (
        <>
          <div className="search-tools">
            <span className="search-count">找到 {total} 条</span>
            <div className="search-filters">
              <label><SlidersHorizontal size={12} />
                <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  <option value="all">全部平台</option>
                  <option value="xiaoyuzhou">小宇宙</option>
                </select>
              </label>
              <label>
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="all">全部状态</option>
                  <option value="ready">已有逐字稿</option>
                  <option value="pending">待处理</option>
                </select>
              </label>
              <label>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="relevance">相关度排序</option>
                  <option value="time">时间排序</option>
                </select>
              </label>
            </div>
          </div>

          {total === 0 && (
            <div className="search-empty">
              <Search size={26} strokeWidth={1.4} />
              <p>没找到「{q}」。</p>
              <p className="dim">
                {scope === "mine"
                  ? "没有匹配的内容。换个说法试试，或者先收几期进来。"
                  : "公共推荐池里没有匹配的内容。"}
              </p>
            </div>
          )}

          {sortedContent.length > 0 && (
            <section className="search-group">
              <h2><Headphones size={15} /> 内容 <em>{sortedContent.length}</em></h2>
              <div className="search-cards">
                {sortedContent.slice(0, 12).map((e) => (
                  <Link key={e.id} href={`/episode/${e.id}`} className="search-card">
                    {displayCover(e) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayCover(e) as string} alt="" />
                    ) : <div className="sc-ph"><Headphones size={16} /></div>}
                    <div className="sc-body">
                      <p>{e.title}</p>
                      <span>{e.author}{e.duration_sec ? ` · ${fmtDur(e.duration_sec)}` : ""} · {fmtDate(e.added_at || e.created_at)}</span>
                    </div>
                    {transcriptIds.has(e.id) && <span className="sc-badge">已成文</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {transcriptHits.length > 0 && (
            <section className="search-group">
              <h2><FileText size={15} /> 逐字稿 <em>{transcriptHits.length}</em></h2>
              <div className="search-lines">
                {transcriptHits.map((h, i) => (
                  <Link key={`${h.ep.id}-${i}`} href={`/episode/${h.ep.id}`} className="search-line">
                    <span className="sl-ep">{h.ep.title.slice(0, 18)}</span>
                    <p>{h.text.length > 120 ? `${h.text.slice(0, 120)}…` : h.text}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {essenceHits.length > 0 && (
            <section className="search-group">
              <h2><Sparkles size={15} /> 精华 <em>{essenceHits.length}</em></h2>
              <div className="search-lines">
                {essenceHits.map((h, i) => (
                  <Link key={`${h.ep.id}-e-${i}`} href={`/episode/${h.ep.id}`} className="search-line">
                    <span className="sl-kind">{h.kind}</span>
                    <p>{h.text}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {noteHits.length > 0 && (
            <section className="search-group">
              <h2><Feather size={15} /> 笔记 <em>{noteHits.length}</em></h2>
              <div className="search-lines">
                {noteHits.map(({ ep, note }) => (
                  <Link key={note.id} href={`/episode/${ep.id}`} className="search-line">
                    <span className="sl-ep">{ep.title.slice(0, 18)}</span>
                    <p>{note.text}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {albumHits.length > 0 && (
            <section className="search-group">
              <h2><Disc3 size={15} /> 专辑 <em>{albumHits.length}</em></h2>
              <div className="search-chips">
                {albumHits.map((t) => (
                  <Link key={t.id} href={`/dashboard?album=${t.id}`} className="search-chip">
                    <i style={{ background: t.color || "#7d6bab" }} />{t.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

    </div>
  );
}
