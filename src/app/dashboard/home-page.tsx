"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, Headphones, Clock, Shuffle, Library, Quote } from "lucide-react";
import type { Episode, Topic } from "./types";
import { displayCover } from "@/lib/guest/data";
import { loadHiddenEpisodes } from "@/lib/guest/store";
import { REC_ITEMS, dailyPick, todayKey, slipOf } from "@/lib/recommend";

const TOPIC_ART = [
  "/textures/magnolia.png",
  "/textures/doodle-set.png",
  "/textures/lotus-bloom.png",
  "/textures/book-stars.png",
  "/textures/headphone-sketch.png",
  "/textures/trees-watercolor.png",
  "/textures/lotus-leaves.png",
  "/textures/flower-glow.png",
  "/textures/flower-peony.png",
  "/textures/grass.png",
];

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时` : `${m} 分钟`;
}

/**
 * 首页：一本刊物的封面页，不是收藏列表。
 * 栏目：今日精选、编辑精选、最新收录。
 */

/** 20 个专辑对应的图标位置（新图 19 个图标，各不相同；未覆盖的用旧图） */
const TOPIC_ICON_POS: Record<string, string> = {
  "社会观察": "0% 0%",
  "教育与学习": "16.6% 0%",
  "商业与创业": "33.3% 0%",
  "人工智能": "50% 0%",
  "经济与金融": "66.6% 0%",
  "文学与阅读": "83.3% 0%",
  "哲学与思想": "100% 0%",
  "医疗与健康": "0% 50%",
  "职业与职场": "33.3% 50%",
  "影视与流行文化": "50% 50%",
  "心理与情绪": "66.6% 50%",
  "艺术与审美": "83.3% 50%",
  "历史与文明": "0% 100%",
  "女性与性别": "16.6% 100%",
  "国际关系与时事": "33.3% 100%",
  "生活与消费": "50% 100%",
  "旅行与地理": "66.6% 100%",
  "科技与互联网": "83.3% 100%",
  "法律与公共制度": "100% 100%",
};

export function HomePage({
  episodes, topics, onOpenDaily, onOpenLibrary, onOpenGraph, doneCount,
}: {
  episodes: Episode[];
  topics: Topic[];
  doneCount: number;
  onOpenDaily: () => void;
  onOpenLibrary: () => void;
  onOpenGraph: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // 编辑精选：按主题去重，挑 6 条（同一主题只出现一次）
  // 精选只能来自内容典藏：库里没有的、被删掉的一律不出现
  // 内容典藏里"已删除"的期（本机隐藏名单）不能出现在任何精选里
  const visible = useMemo(() => {
    let hidden: string[] = [];
    try { hidden = loadHiddenEpisodes(); } catch { /* 忽略 */ }
    const h = new Set(hidden);
    return episodes.filter((e) => !h.has(e.id));
  }, [episodes]);
  const allowed = useMemo(() => new Set(visible.map((e) => e.id)), [visible]);
  // 库里的期不一定带 id；用 source_url 反查真实 id，避免跳到 /episode/undefined
  const idByUrl = useMemo(
    () => new Map(visible.map((e) => [String(e.source_url ?? ""), e.id])),
    [visible]
  );
  // 胶囊上的词是"二级主题"（人文 / 社会观察…），专辑名不一定完全一致，做一次模糊匹配
  const albumIdOf = useCallback((name: string) => {
    const exact = topics.find((t) => t.name === name);
    if (exact) return exact.id;
    const loose = topics.find((t) => t.name.includes(name) || name.includes(t.name));
    return loose?.id ?? null;
  }, [topics]);
  const epId = (ep: { id?: string; source_url?: string | null }) =>
    ep.id ?? idByUrl.get(String(ep.source_url ?? "")) ?? "";
  const pool = useMemo(() => REC_ITEMS.filter((r) => allowed.has(r.episode.id)), [allowed]);

  // 编辑精选也每天轮换：按「第几天」错开起点，保证同一天全站一致、第二天全换
  const picks = useMemo(() => {
    const day = Math.floor(Date.now() / 86400000);
    const offset = (day * 7) % Math.max(1, pool.length);
    const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
    const seen = new Set<string>();
    const out = [];
    for (const it of rotated) {
      if (seen.has(it.theme)) continue;
      seen.add(it.theme);
      out.push(it);
      if (out.length === 6) break;
    }
    return out;
  }, []);

  // 进场：和开屏的转场接上——刊头先落，其余依次浮起
  useEffect(() => {
    const gsap = (window as unknown as { gsap?: any }).gsap;
    const root = rootRef.current;
    if (!gsap || !root) return;
    const ctx = gsap.context(() => {
      gsap.from(".home-mast-top, .home-title, .home-deck", {
        y: 26, opacity: 0, duration: 0.9, delay: 0.15, stagger: 0.09, ease: "power3.out",
      });
      gsap.from(".home-feature, .home-topic, .home-recent-row, .home-foot", {
        y: 18, opacity: 0, duration: 0.7, delay: 0.45, stagger: 0.05, ease: "power2.out",
      });
    }, root);
    return () => ctx.revert();
  }, [pool]);

  const featured = useMemo(() => {
    const d = dailyPick();
    if (d && allowed.has(d.episode.id)) return d;
    return pool.length ? pool[Math.floor(Date.now() / 86400000) % pool.length] : null;
  }, [allowed, pool]);
  // 主题胶囊 = 内容典藏里的专辑（同一套 10 个分类），数量按实际期数算
  const byTopic = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of visible) {
      const t = topics.find((x) => x.id === e.topic_id);
      if (!t) continue;
      count.set(t.name, (count.get(t.name) ?? 0) + 1);
    }
    const list = topics
      .map((t) => [t.name, count.get(t.name) ?? 0] as [string, number])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    return list;
  }, [topics, visible]);
  const recent = episodes
    .slice()
    .sort((a, b) => new Date(b.added_at || b.created_at).getTime() - new Date(a.added_at || a.created_at).getTime())
    .slice(0, 3);

  return (
    <div className="home-page" ref={rootRef}>
      <header className="home-masthead">
        <div className="home-mast-top">
          <span className="home-issue">ISSUE · {todayKey()}</span>
        </div>
        <h1 className="home-title">Mantra</h1>
        <div className="home-mast-side">
          <span className="hms-label">今日一签</span>
          <button className="hms-card" onClick={onOpenDaily}>
            <span className="hms-word">{featured ? slipOf(featured.theme).word : "今日一签"}</span>
            <span className="hms-line">{featured ? slipOf(featured.theme).line : "让今天的灵感替你做个决定。"}</span>
            <span className="hms-go">去抽一签 →</span>
          </button>
          <span className="hms-meta">本机 {episodes.length} 期 · 公共 {REC_ITEMS.length} 条</span>
        </div>

        <div className="home-deck">
          <span className="hd-kicker">PODCAST MANTRA</span>
          <p className="hd-lead">思想所至，世界随之展开。</p>
          <p className="hd-body">让声音、影像与文字，沉淀为值得反复回味的思想。</p>
          <div className="hd-about">
            <span className="hd-q">WHAT IS PODCAST MANTRA?</span>
            <p>连接声音与思想的 AI 播客知识管理与探索平台。</p>
          </div>
        </div>
      </header>

      {/* 今日精选：横向条带，点进每日一荐 */}
      {featured && (
        <Link className="home-feature" href={`/episode/${epId(featured.episode)}`}>
          <span className="hf-label"><Sparkles size={12} /> 今日精选 · Today&rsquo;s Pick</span>
          <div className="hf-main">
            <div className="hf-cover">
              {displayCover(featured.episode) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayCover(featured.episode) as string} alt="" />
              ) : <div className="hf-ph"><Headphones size={20} /></div>}
            </div>
            <div className="hf-text">
              <h2>{featured.episode.title}</h2>
              <p className="hf-reason"><Quote size={11} /> {featured.reason}</p>
              <div className="hf-meta">
                <span>{featured.episode.author}</span>
                {featured.episode.duration_sec && <span>· {fmtDur(featured.episode.duration_sec)}</span>}
                <span>· {featured.topic}</span>
              </div>
            </div>
            <ArrowRight size={18} className="hf-arrow" />
          </div>
        </Link>
      )}

      {/* 浏览主题 */}
      <section className="home-shelf">
        <div className="home-shelf-head">
          <h3>主题胶囊</h3>
          <span>Browse by Topic</span>
        </div>
        <div className="topic-caps">
          {byTopic.map(([t, n], i) => {
            const art = TOPIC_ART[i % TOPIC_ART.length];
            return (
              <Link
                key={t}
                className="topic-cap"
                href={albumIdOf(t) ? `/dashboard?album=${albumIdOf(t)}` : `/dashboard?view=library&subtopic=${encodeURIComponent(t)}`}
                title={`${t} · ${n} 条`}
              >
                <span className="tc-art">
                  {TOPIC_ICON_POS[t] ? (
                    <span
                      className="tc-sprite tc-sprite-new"
                      style={{ backgroundPosition: TOPIC_ICON_POS[t] }}
                    />
                  ) : (
                    <span className="tc-sprite" style={{ backgroundPosition: `${(i % 5) * 25}% ${i < 5 ? 0 : 100}%` }} />
                  )}
                </span>
                <strong>{t}</strong>
                <em>{n}</em>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 编辑精选 */}
      {picks.length > 0 && (
        <section className="home-picks">
          <div className="home-shelf-head">
            <h3>编辑精选</h3>
            <span>Editor&rsquo;s Picks</span>
          </div>
          <div className="home-pick-grid">
            {picks.map((it) => (
              <Link key={it.key} href={`/episode/${epId(it.episode)}`} className="home-pick">
                <div className="hp-cover">
                  {displayCover(it.episode) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={displayCover(it.episode) as string} alt="" />
                  ) : <div className="hp-ph"><Headphones size={18} /></div>}
                </div>
                <div className="hp-body">
                  <span className="hp-theme">{it.theme}</span>
                  <h4>{it.episode.title}</h4>
                  <p>{it.reason}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 我的最近 */}
      <section className="home-recent">
        <div className="home-shelf-head">
          <div className="h3-pair">
            <h3>最新收录</h3>
            <span>Recently Added</span>
          </div>
          <button className="home-more" onClick={onOpenLibrary}>去内容库 <ArrowRight size={12} /></button>
        </div>
        {recent.length === 0 ? (
          <p className="home-empty">还没有收藏。去「每日一荐」抽一签，或粘一条链接进来。</p>
        ) : (
          <div className="home-recent-list">
            {recent.map((e) => (
              <Link key={e.id} href={`/episode/${e.id}`} className="home-recent-row">
                {displayCover(e) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayCover(e) as string} alt="" />
                ) : <div className="hr-ph"><Library size={16} /></div>}
                <span className="hr-title">{e.title}</span>
                <span className="hr-meta">{e.duration_sec ? <><Clock size={10} />{fmtDur(e.duration_sec)}</> : e.author}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
