"use client";

import Link from "next/link";
import { BookHeart, Sparkles, ArrowUpRight, Feather } from "lucide-react";
import type { Episode, Topic } from "./types";
import { displayCover } from "@/lib/guest/data";
import { FlowerRatingReadonly, FLOWER_WORDS } from "./flower-rating";

function fmtDate(s: string | null | undefined) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function Journal({ episodes, topics }: { episodes: Episode[]; topics: Topic[] }) {
  const topicMap = Object.fromEntries(topics.map((t) => [t.id, t]));
  const marked = episodes
    .filter((e) => (e.rating && e.rating > 0) || (e.note && e.note.trim()))
    .sort((a, b) => new Date(b.added_at || b.created_at).getTime() - new Date(a.added_at || a.created_at).getTime());

  const rated = marked.filter((e) => e.rating && e.rating > 0);
  const avg = rated.length
    ? (rated.reduce((s, e) => s + (e.rating || 0), 0) / rated.length).toFixed(1)
    : "—";

  if (marked.length === 0) {
    return (
      <div className="journal-page">
        <div className="dash-eyebrow"><BookHeart size={13} /> 余音手账</div>
        <h1 className="brush-title">听完之后，写下的那一句。</h1>
        <div className="dash-placeholder" style={{ marginTop: 28 }}>
          <div className="dash-empty-art"><Feather size={34} strokeWidth={1.4} /></div>
          <h2>这本手账还空着</h2>
          <p>在内容卡片上点亮几朵小花、或记下一句余音，<br />它们会慢慢攒成这一页。</p>
          <span className="dash-soon"><Sparkles size={13} /> 每一朵花、每一句话，都会收进这里</span>
        </div>
      </div>
    );
  }

  return (
    <div className="journal-page">
      <div className="dash-eyebrow"><BookHeart size={13} /> 余音手账</div>
      <h1 className="brush-title">听完之后，写下的那一句。</h1>
      <p className="album-sub">那些点亮的小花、随手写下的余音，都收在这一页。</p>

      <div className="journal-stats">
        <div className="journal-stat sketch-card"><BookHeart size={18} /><div><strong>{marked.length}</strong><span>则留痕</span></div></div>
        <div className="journal-stat sketch-card"><Sparkles size={18} /><div><strong>{avg}</strong><span>平均喜爱 · 朵</span></div></div>
        <div className="journal-stat sketch-card"><Feather size={18} /><div><strong>{marked.filter((e) => e.note?.trim()).length}</strong><span>句余音</span></div></div>
      </div>

      <div className="journal-grid">
        {marked.map((e, idx) => {
          const topic = e.topic_id ? topicMap[e.topic_id] : undefined;
          return (
            <Link
              key={e.id}
              href={`/episode/${e.id}`}
              className={`journal-note sketch-card ${e.note?.trim() ? "has-note" : ""}`}
              style={{ "--tilt": `${(idx % 4 - 1.5) * 0.9}deg` } as React.CSSProperties}
            >
              <span className="journal-pin" />
              <div className="journal-note-top">
                {displayCover(e) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayCover(e) as string} alt="" className="journal-thumb" />
                ) : (
                  <div className="journal-thumb ph"><Feather size={16} /></div>
                )}
                <div className="journal-note-meta">
                  <div className="journal-note-title">{e.title}</div>
                  <div className="journal-note-date">{fmtDate(e.added_at || e.created_at)}</div>
                </div>
              </div>
              {e.rating && e.rating > 0 && (
                <div className="journal-flower-line">
                  <FlowerRatingReadonly value={e.rating} size={14} />
                  <span>{FLOWER_WORDS[e.rating]}</span>
                </div>
              )}
              {e.note?.trim() && <p className="journal-quote">「{e.note}」</p>}
              <div className="journal-note-foot">
                {topic && <span className="journal-topic"><i style={{ background: topic.color || "#7d6bab" }} />{topic.name}</span>}
                <ArrowUpRight size={14} className="journal-go" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
