"use client";

import { useEffect, useMemo, useState } from "react";
import { Sun, Check, Copy, Sparkles } from "lucide-react";
import { dailyQuote } from "@/lib/words/quotes";

const KEY = "pm_checkins";
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 连续签到：今天没签就从昨天往前数，算「到目前为止连着几天」 */
function streakOf(list: string[], base: Date) {
  let n = 0;
  const d = new Date(base);
  if (!list.includes(ymd(d))) d.setDate(d.getDate() - 1);
  while (list.includes(ymd(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/**
 * 词云页顶部的「今日日签 + 每日签到」。
 * 日签按日期取句（同一天稳定）；签到每天点亮一枚贝壳，存在本地。
 */
export function DailyPanel() {
  const [today, setToday] = useState<Date | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // 挂载后再取日期，避免服务端与浏览器时区不同导致 hydration 抖动
  useEffect(() => {
    setToday(new Date());
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setDays(JSON.parse(raw));
    } catch { /* 忽略 */ }
  }, []);

  const quote = useMemo(() => (today ? dailyQuote(today) : null), [today]);
  const checked = today ? days.includes(ymd(today)) : false;
  const streak = useMemo(() => (today ? streakOf(days, today) : 0), [days, today]);

  const week = useMemo(() => {
    if (!today) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      const key = ymd(d);
      return {
        key,
        on: days.includes(key),
        isToday: i === 6,
        label: WEEK[d.getDay()],
        day: d.getDate(),
      };
    });
  }, [today, days]);

  function checkIn() {
    if (!today || checked) return;
    const next = [...new Set([...days, ymd(today)])];
    setDays(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
  }

  async function copyQuote() {
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(`「${quote.text}」—— ${quote.author}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* 忽略 */ }
  }

  return (
    <div className="daily-row">
      <section className="daily-card">
        <span className="daily-tape" aria-hidden="true" />
        <div className="daily-top">
          <span className="daily-date">
            {today ? `${today.getMonth() + 1} 月 ${today.getDate()} 日 · 周${WEEK[today.getDay()]}` : "今日"}
          </span>
          <span className="daily-tag"><Sun size={11} /> 今日一言</span>
        </div>
        <blockquote className="daily-text">{quote ? `「${quote.text}」` : "……"}</blockquote>
        <div className="daily-bottom">
          <cite>{quote ? `—— ${quote.author}` : ""}</cite>
          <button className="daily-copy" onClick={copyQuote} disabled={!quote}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "已抄下" : "抄下来"}
          </button>
        </div>
      </section>

      <section className="checkin-card">
        <div className="checkin-top">
          <span className="checkin-title"><Sparkles size={12} /> 每日签到</span>
          <span className="checkin-streak">{streak > 0 ? `连续 ${streak} 天` : "还没开始"}</span>
        </div>

        <div className="checkin-shells">
          {week.map((d) => (
            <button
              key={d.key}
              type="button"
              className={`shell ${d.on ? "on" : ""} ${d.isToday ? "today" : ""}`}
              onClick={d.isToday ? checkIn : undefined}
              disabled={!d.isToday || checked}
              title={`${d.key}${d.on ? " · 已点亮" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ornaments/shell.webp" alt="" />
              <em>{d.isToday ? "今" : d.label}</em>
            </button>
          ))}
        </div>

        <p className="checkin-hint">
          {checked ? "今天已经亮过了，明天见。" : "点今天的贝壳，把它点亮。"}
        </p>
      </section>
    </div>
  );
}
