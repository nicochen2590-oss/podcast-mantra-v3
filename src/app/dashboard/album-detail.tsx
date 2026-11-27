"use client";

/**
 * 一个专辑的内部页：不只是"一堆期"，还要有这一张专辑自己的理解。
 * 收藏内容 / 专题摘要 / 关键观点 / 用户笔记 / 关联专辑
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Disc3, ArrowLeft, Trash2, Headphones, Clock, Sparkles,
  BookOpen, Quote, Feather, Network, Pencil, Save, Plus, Library,
} from "lucide-react";
import type { Episode, Topic, Highlight, EpisodeNote } from "./types";
import { displayCover } from "@/lib/guest/data";
import { loadTranscriptMap, loadTopicMeta, saveTopicMeta } from "@/lib/guest/store";

type Props = {
  topic: Topic;
  topics: Topic[];
  episodes: Episode[];
  onBack: () => void;
  onOpenTopic: (id: string) => void;
  onOpenEpisode: (id: string) => void;
  onDelete: (t: Topic) => void;
};

const KNOWN_NOTES_KEY = "pm_episode_notes_v1";

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}小时${m % 60}分` : `${m}分钟`;
}

export function AlbumDetail({
  topic, topics, episodes, onBack, onOpenTopic, onOpenEpisode, onDelete,
}: Props) {
  const [tab, setTab] = useState<"items" | "summary" | "points" | "notes" | "related">("items");
  const [editing, setEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [meta, setMeta] = useState(() => loadTopicMeta());

  const eps = useMemo(() => episodes.filter((e) => e.topic_id === topic.id), [episodes, topic.id]);
  const transcripts = useMemo(() => loadTranscriptMap(), []);

  const highlights = useMemo(() => {
    const out: { episode: Episode; h: Highlight }[] = [];
    for (const e of eps) {
      const t = transcripts[e.id];
      for (const h of t?.highlights ?? []) out.push({ episode: e, h });
    }
    return out.slice(0, 12);
  }, [eps, transcripts]);

  const points = useMemo(() => {
    const out: { episode: Episode; name: string; start: number }[] = [];
    for (const e of eps) {
      const mm = transcripts[e.id]?.mindmap;
      for (const c of mm?.children ?? []) out.push({ episode: e, name: c.name, start: c.start_ms ?? 0 });
    }
    return out.slice(0, 12);
  }, [eps, transcripts]);

  const notes = useMemo(() => {
    let all: Record<string, EpisodeNote[]> = {};
    try { all = JSON.parse(localStorage.getItem(KNOWN_NOTES_KEY) || "{}"); } catch { all = {}; }
    const out: { episode: Episode; note: EpisodeNote }[] = [];
    for (const e of eps) for (const n of all[e.id] ?? []) out.push({ episode: e, note: n });
    return out;
  }, [eps]);

  const autoSummary = useMemo(() => {
    const bits = eps.map((e) => (e.summary ?? "").trim()).filter(Boolean).slice(0, 3);
    if (!bits.length) return "";
    return `这一张收了 ${eps.length} 期，主题环绕「${topic.name}」。${bits.join(" ")}`.slice(0, 420);
  }, [eps, topic.name]);

  const relatedTopics = useMemo(() => {
    const mine = new Set<string>();
    for (const e of eps) for (const k of transcripts[e.id]?.keywords ?? []) mine.add(k.term);
    return topics
      .filter((t) => t.id !== topic.id)
      .map((t) => {
        const their = new Set<string>();
        episodes.filter((e) => e.topic_id === t.id).forEach((e) => {
          for (const k of transcripts[e.id]?.keywords ?? []) their.add(k.term);
        });
        const overlap = [...mine].filter((k) => their.has(k));
        return { topic: t, overlap };
      })
      .sort((a, b) => b.overlap.length - a.overlap.length)
      .slice(0, 4);
  }, [eps, episodes, topics, topic.id, transcripts]);

  const summaryText = meta[topic.id]?.summary ?? "";
  const albumNote = meta[topic.id]?.note ?? "";

  function saveSummary() {
    saveTopicMeta(topic.id, { summary: summaryDraft.trim() || null });
    setMeta(loadTopicMeta());
    setEditing(false);
  }

  return (
    <div className="album-detail">
      <button className="album-back" onClick={onBack}><ArrowLeft size={15} /> 回专辑墙</button>

      <header className="album-detail-head">
        <span className="album-detail-glyph" style={{ background: topic.color || "#9a8bc4" }}><Disc3 size={22} /></span>
        <div>
          <h1 className="brush-title">{topic.name}</h1>
          <p>{eps.length} 期 · 收进这一间屋子的声音</p>
        </div>
        <div className="album-detail-actions">
          <button className="danger" onClick={() => onDelete(topic)}><Trash2 size={14} /> 删专辑</button>
        </div>
      </header>

      <nav className="album-tabs">
        {([["items", "收藏内容", Library], ["summary", "专题摘要", BookOpen], ["points", "关键观点", Quote], ["notes", "用户笔记", Feather], ["related", "关联专辑", Network]] as const).map(([k, label, Icon]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </nav>

      {tab === "items" && (
        eps.length ? (
          <div className="album-items">
            {eps.map((e) => (
              <Link key={e.id} href={`/episode/${e.id}`} className="album-item">
                {displayCover(e) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayCover(e) as string} alt="" />
                ) : <div className="album-item-ph"><Headphones size={18} /></div>}
                <div>
                  <p>{e.title}</p>
                  <span>{e.author}{e.duration_sec ? ` · ${fmtDur(e.duration_sec)}` : ""}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="album-empty">这一间还空着。回内容库，把想放的期「移到专辑」里来。</p>
        )
      )}

      {tab === "summary" && (
        <div className="album-panel">
          <div className="panel-head">
            <h2><BookOpen size={16} /> 专题摘要</h2>
            {!editing && (
              <button className="transcript-mini" onClick={() => { setSummaryDraft(summaryText || autoSummary); setEditing(true); }}>
                <Pencil size={11} /> {summaryText ? "改" : "写一段"}
              </button>
            )}
          </div>
          {editing ? (
            <>
              <textarea className="tp-textarea" rows={6} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} />
              <div className="tp-actions" style={{ marginTop: 10 }}>
                <button className="tp-ghost" onClick={() => setEditing(false)}>取消</button>
                <button className="tp-save" onClick={saveSummary}><Save size={14} /> 存成这张专辑的摘要</button>
              </div>
            </>
          ) : (
            <p className="summary-text">{summaryText || autoSummary || "还没收几期，暂时拼不出摘要。收 2–3 期之后这里会自动出现一段。"}</p>
          )}
          {!summaryText && autoSummary && <p className="album-auto-note"><Sparkles size={11} /> 这段由各期简介临时拼成，点「写一段」可以改成你自己的话</p>}
        </div>
      )}

      {tab === "points" && (
        <div className="album-panel">
          <div className="panel-head"><h2><Quote size={16} /> 关键观点</h2></div>
          {points.length || highlights.length ? (
            <div className="album-points">
              {points.map((p, i) => (
                <button key={`${p.episode.id}-${i}`} className="album-point" onClick={() => onOpenEpisode(p.episode.id)}>
                  <span className="ap-tag">{p.episode.author?.slice(0, 10)}</span>
                  <span className="ap-text">{p.name}</span>
                </button>
              ))}
              {highlights.map(({ episode, h }, i) => (
                <button key={`h-${episode.id}-${i}`} className="album-point quote" onClick={() => onOpenEpisode(episode.id)}>
                  <span className="ap-tag">{episode.author?.slice(0, 10)}</span>
                  <span className="ap-text">「{h.text.slice(0, 46)}」</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="album-empty">还没有观点。等这一间里有几期转写完成，会自动把议题和金句抽上来。</p>
          )}
        </div>
      )}

      {tab === "notes" && (
        <div className="album-panel">
          <div className="panel-head"><h2><Feather size={16} /> 用户笔记</h2></div>
          <textarea
            className="tp-textarea"
            rows={3}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="这张专辑想留给未来的自己什么话？"
          />
          <div className="tp-actions" style={{ marginTop: 8 }}>
            <button
              className="tp-save"
              disabled={!noteDraft.trim()}
              onClick={() => { saveTopicMeta(topic.id, { note: noteDraft.trim() }); setMeta(loadTopicMeta()); setNoteDraft(""); }}
            >
              <Plus size={14} /> 记下来
            </button>
          </div>
          {albumNote && <div className="album-note-card"><span>专辑笔记</span><p>{albumNote}</p></div>}
          {notes.length ? (
            <div className="album-note-list">
              {notes.map(({ episode, note }) => (
                <Link key={note.id} href={`/episode/${episode.id}`} className="album-note-row">
                  <span className="anr-time">{new Date(note.at).toLocaleDateString("zh-CN")}</span>
                  <span className="anr-ep">{episode.title.slice(0, 16)}</span>
                  <p>{note.text}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="album-empty">这一间里的期还没有笔记。笔记是在每一期的「笔记」栏里写的。</p>
          )}
        </div>
      )}

      {tab === "related" && (
        <div className="album-panel">
          <div className="panel-head"><h2><Network size={16} /> 关联专辑</h2></div>
          {relatedTopics.length ? (
            <div className="album-related">
              {relatedTopics.map(({ topic: t, overlap }) => (
                <button key={t.id} className="album-rel-card" onClick={() => onOpenTopic(t.id)} style={{ borderColor: t.color || "#7d6bab" }}>
                  <span className="arc-name"><i style={{ background: t.color || "#7d6bab" }} />{t.name}</span>
                  <span className="arc-meta">
                    {episodes.filter((e) => e.topic_id === t.id).length} 期
                    {overlap.length ? ` · 共享 ${overlap.slice(0, 2).join("、")}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="album-empty">还没有关联。等不同专辑里的期有了逐字稿，共同的词会把它们连起来。</p>
          )}
        </div>
      )}
    </div>
  );
}
