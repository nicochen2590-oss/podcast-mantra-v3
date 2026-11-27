"use client";

import Link from "next/link";
import { CalendarDays, Clock, ArrowUpRight, Sparkles } from "lucide-react";
import type { Episode, Topic } from "./types";
import { FlowerRatingReadonly } from "./flower-rating";
import { displayCover } from "@/lib/guest/data";

const MONTH_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

function stampOf(e: Episode) {
  const raw = e.added_at || e.created_at;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { key: "未知", year: "", month: 0, date: "" };
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return {
    key: `${String(year).slice(2)}.${String(month).padStart(2, "0")}`,
    year: String(year),
    month,
    date: `${month}月${d.getDate()}日`,
  };
}

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}小时${m % 60}分` : `${m}分钟`;
}

/**
 * 月度书架：按「收进来的那个月」把内容摞成一格一格的抽屉。
 * 26.11 这一格，就是 2026 年 11 月收下的全部声音。
 */
export function MonthArchive({ episodes, topics }: { episodes: Episode[]; topics: Topic[] }) {
  const topicMap = Object.fromEntries(topics.map((t) => [t.id, t]));

  const groups = new Map<string, { year: string; month: number; items: Episode[] }>();
  for (const e of episodes) {
    const s = stampOf(e);
    const g = groups.get(s.key);
    if (g) g.items.push(e);
    else groups.set(s.key, { year: s.year, month: s.month, items: [e] });
  }
  const months = [...groups.entries()]
    .map(([key, v]) => ({
      key, year: v.year, month: v.month,
      items: v.items.sort(
        (a, b) => new Date(b.added_at || b.created_at).getTime() - new Date(a.added_at || a.created_at).getTime()
      ),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));

  if (episodes.length === 0) {
    return (
      <div className="dash-placeholder">
        <div className="dash-empty-art"><CalendarDays size={34} strokeWidth={1.4} /></div>
        <h2 className="brush-title small">书架还空着</h2>
        <p>每收进一期，就会落进当月那一格。<br />等你攒下第一个月，这里就有一本按月份翻的书。</p>
        <span className="dash-soon"><Sparkles size={13} /> 按入库月份自动归档</span>
      </div>
    );
  }

  return (
    <div className="month-page">
      <div className="dash-eyebrow"><CalendarDays size={13} /> 月度书架</div>
      <h1 className="brush-title">声音按月，摞成一格一格。</h1>
      <p className="album-sub">
        共 <strong>{episodes.length}</strong> 期，散在 <strong>{months.length}</strong> 个月里。想回到某个时候的自己，翻那一格就好。
      </p>

      <div className="month-list">
        {months.map((m) => (
          <section className="month-block" key={m.key}>
            <div className="month-label">
              <span className="month-num">{m.key}</span>
              <span className="month-cn">{MONTH_CN[m.month - 1] ?? m.month} 月 · {m.items.length} 期</span>
            </div>

            <div className="month-shelf sketch-card">
              {m.items.map((e, i) => {
                const topic = e.topic_id ? topicMap[e.topic_id] : undefined;
                return (
                  <Link href={`/episode/${e.id}`} className="month-row" key={e.id} style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
                    {displayCover(e) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayCover(e) as string} alt="" className="month-cover" />
                    ) : (
                      <div className="month-cover ph"><CalendarDays size={15} /></div>
                    )}
                    <div className="month-row-main">
                      <div className="month-row-title">{e.title}</div>
                      <div className="month-row-meta">
                        <span>{stampOf(e).date} 收</span>
                        {e.duration_sec && <span><Clock size={11} />{fmtDur(e.duration_sec)}</span>}
                        {topic && <span className="month-row-topic"><i style={{ background: topic.color || "#7d6bab" }} />{topic.name}</span>}
                      </div>
                    </div>
                    {e.rating && e.rating > 0 && (
                      <span className="month-row-flowers"><FlowerRatingReadonly value={e.rating} size={11} /></span>
                    )}
                    <ArrowUpRight size={14} className="month-row-go" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
