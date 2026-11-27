"use client";

/**
 * 每日一荐：一个公共的「抽签」仪式。
 * 与私人收藏完全无关：只读公共池，不写入任何本机内容库。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Clock, Headphones, Quote, RefreshCw, Video, FileText } from "lucide-react";
import type { RecItem } from "@/lib/recommend";
import {
  dailyPick, drawOne, findRecByKey, loadDailyDraw, saveDailyDraw, slipOf, todayKey, REC_ITEMS,
} from "@/lib/recommend";
import { displayCover } from "@/lib/guest/data";

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}

const TYPE_ICON = { 播客: Headphones, 视频: Video, 文章: FileText } as const;

/** 摘掉简介开头的寒暄与赞助口播，卡片上直接从正题开始 */
function tidyBlurb(text: string | null | undefined): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
  const skip = /^(hel+o+|hi+|哈+|呃|嗯|哎|各位|大家好|宝子们|朋友们|感谢|本期节目|这期节目|欢迎)/i;
  const kept = sentences.filter((x) => !skip.test(x) && !/(赞助|优惠|公众号|微信|下单|社群)/.test(x));
  return (kept.length ? kept : sentences).join("").slice(0, 160);
}

export function DailyPage({ onEnterLibrary }: { onEnterLibrary?: () => void }) {
  const [item, setItem] = useState<RecItem | null>(null);
  const [count, setCount] = useState(1);
  const [phase, setPhase] = useState<"idle" | "shaking" | "rising" | "slip" | "card">("idle");
  const [open, setOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const saved = loadDailyDraw();
    if (saved) {
      const rec = findRecByKey(saved.key);
      if (rec) { setItem(rec); setCount(saved.count); setPhase("card"); return; }
    }
    const today = dailyPick();
    if (today) {
      setItem(today);
      setCount(1);
      saveDailyDraw({ date: todayKey(), key: today.key, count: 1 });
      setPhase("card");
    }
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); };
  }, []);

  function pick() {
    if (phase !== "idle" && phase !== "card") return;
    const next = drawOne({ mode: "random", avoidKey: item?.key ?? null, items: REC_ITEMS });
    if (!next) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextCount = count + 1;

    const commit = () => {
      setItem(next);
      setCount(nextCount);
      saveDailyDraw({ date: todayKey(), key: next.key, count: nextCount });
      setPhase("card");
      setOpen(true);
    };

    if (reduced) { commit(); return; }

    setPhase("shaking");
    timers.current.push(window.setTimeout(() => setPhase("rising"), 620));
    timers.current.push(window.setTimeout(() => setPhase("slip"), 1080));
    timers.current.push(window.setTimeout(commit, 1900));
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const slip = useMemo(() => (item ? slipOf(item.theme) : null), [item]);
  const Icon = item ? TYPE_ICON[item.type as keyof typeof TYPE_ICON] ?? Headphones : Headphones;
  const busy = phase === "shaking" || phase === "rising";
  const raised = phase === "rising" || phase === "slip" || phase === "card";

  return (
    <div className="daily-page">
      <div className="daily-top">
        <span>DAILY DISCOVERY</span>
        <span>{todayKey()}</span>
      </div>

      {/* 抽签台：平躺的牌扇 + 抽出来的那一张 */}
      <div className={`draw-stage ${phase === "shaking" ? "shuffling" : ""}`}>
        <div className="draw-fan">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/draw-fan.jpg" alt="" />
        </div>
        <div className={`draw-card ${raised ? "on" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/draw-card.jpg" alt="" />
        </div>
      </div>

      <span className="draw-kicker">A little wisdom, picked for today.</span>
      <h1 className="draw-h1">今天，抽一条灵感。</h1>
      <p className="draw-sub">今日知识签 · 每天遇见一份意外的灵感。</p>

      <button className={`draw-btn ${busy ? "is-busy" : ""}`} onClick={pick} disabled={busy || !REC_ITEMS.length}>
        {busy ? <><RefreshCw size={16} className="spin-slow" /> 正在为你寻找今天的灵感……</> : <><RefreshCw size={16} /> 再抽一签</>}
      </button>

      {!REC_ITEMS.length && <p className="daily-empty">今天的签筒还空着，过一会儿再来看看。</p>}

      {/* 抽中的内容：像一张卡弹到屏幕中央 */}
      {open && item && slip && (
        <div className="pick-modal" onClick={() => setOpen(false)}>
          <div className="pick-sheet" onClick={(e) => e.stopPropagation()}>
            <button className="pick-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>

            <div className="pick-media">
              {displayCover(item.episode) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayCover(item.episode) as string} alt="" />
              ) : <div className="pick-ph"><Headphones size={40} /></div>}
            </div>

            <div className="pick-info">
              <span className="slip-no">TODAY&apos;S DRAW · {String(count).padStart(3, "0")}</span>
              <h2>{item.episode.title}</h2>
              <span className="pick-author">{item.episode.author ?? "未知主播"}</span>
              <p className="pick-blurb">{tidyBlurb(item.episode.summary) || "这一期没有留下简介。"}</p>
              <p className="pick-reason"><Quote size={11} /> {item.reason}</p>

              <div className="pick-slip-inline">
                <strong>{slip.word}</strong>
                <span>{slip.line}</span>
              </div>

              <div className="pick-meta">
                <span><Icon size={12} />{item.type}</span>
                {item.episode.duration_sec && <span><Clock size={12} />{fmtDur(item.episode.duration_sec)}</span>}
                <span className="pick-tag">{item.theme}</span>
              </div>

              <div className="pick-actions">
                <Link className="pick-open" href={`/episode/${item.episode.id}`}>看这一期 <ArrowUpRight size={14} /></Link>
                {item.episode.source_url && (
                  <a className="pick-src" href={item.episode.source_url} target="_blank" rel="noreferrer">原链接 ↗</a>
                )}
                <button className="pick-again" onClick={() => { setOpen(false); window.setTimeout(pick, 120); }}>再抽一签</button>
              </div>
              <p className="pick-footnote">每天一条，遇见一点新知。</p>
            </div>
          </div>
        </div>
      )}

      {onEnterLibrary && (
        <button className="daily-quiet" onClick={onEnterLibrary}>回我的书斋 →</button>
      )}
    </div>
  );
}
