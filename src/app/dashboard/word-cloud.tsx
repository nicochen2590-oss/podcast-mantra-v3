"use client";

import { useMemo, useState } from "react";
import { Cloud, Sparkles, TrendingUp } from "lucide-react";
import type { Episode, Topic } from "./types";
import { MEANINGFUL_WORDS } from "@/lib/topics/presets";

// 只保留「读得懂的词」：概念词表命中 + 书名号/引号里的完整短语 + 专辑名。
// 不再按固定窗口滑窗切字，避免出现「兰壮」「游者」这类无意义碎片。
const CONCEPTS = [...MEANINGFUL_WORDS].sort((a, b) => b.length - a.length);

function extractWords(text: string, topics: Topic[]): string[] {
  const out: string[] = [];
  const quoted = text.match(/[《「"]([^》」"]{2,14})[》」"]/g) || [];
  quoted.forEach((q) => out.push(q.slice(1, -1)));

  let rest = text;
  CONCEPTS.forEach((w) => {
    if (rest.includes(w)) { out.push(w); rest = rest.split(w).join(" "); }
  });
  topics.forEach((t) => { if (text.includes(t.name)) out.push(t.name); });

  return [...new Set(out.filter((w) => w.length >= 2))];
}

const PALETTE = ["#7d6bab", "#9a8bc4", "#b98a86", "#6f8fa8", "#c0a06a", "#8aa387", "#a97b93", "#b0873e"];

export function WordCloud({ episodes, topics }: { episodes: Episode[]; topics: Topic[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const words = useMemo(() => {
    const freq = new Map<string, number>();
    episodes.forEach((e) => {
      const text = `${e.title} ${e.episode_no || ""} ${e.author || ""} ${e.summary || ""} ${e.note || ""}`;
      // 同一期里同一个词只计一次
      extractWords(text, topics).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    });
    // 专辑本身就是按兴趣划分的有意义词：所含期数越多，字越大；
    // 暂时空着的专辑也留一个小字，保证词云饱满且每个词都读得懂。
    topics.forEach((t) => {
      const count = episodes.filter((e) => e.topic_id === t.id).length;
      freq.set(t.name, (freq.get(t.name) || 0) + Math.max(count, 1));
    });
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 60);
  }, [episodes, topics]);

  const max = words[0]?.[1] || 1;

  if (episodes.length === 0 && topics.length === 0) {
    return (
      <div className="dash-placeholder">
        <div className="dash-empty-art"><Cloud size={34} strokeWidth={1.4} /></div>
        <h2>词云洞察</h2>
        <p>收进几期之后，这里会从标题、余音与专辑里，浮出你最近常回到的词。</p>
        <span className="dash-soon"><Sparkles size={13} /> 词汇越常出现，字就越大</span>
      </div>
    );
  }

  return (
    <div className="cloud-page">
      <div className="dash-eyebrow"><Sparkles size={13} /> 词云洞察</div>
      <h1 className="cloud-title english">Listen. Notice. Keep.</h1>
      <p className="cloud-sub">从 <strong>{episodes.length}</strong> 期内容的标题、余音与 <strong>{topics.length}</strong> 张专辑里，慢慢聚起来。</p>


      <div className="cloud-canvas sketch-card">
        <div className="cloud-words">
          {words.map(([word, count], i) => {
            const ratio = count / max;
            const size = 15 + ratio * 44;
            const color = PALETTE[i % PALETTE.length];
            return (
              <span
                key={word}
                className={`cloud-word ${hovered === word ? "hovered" : ""}`}
                style={{
                  fontSize: `${size}px`,
                  color,
                  transform: `rotate(${((i % 5) - 2) * 2}deg)`,
                  zIndex: hovered === word ? 10 : 1,
                }}
                onMouseEnter={() => setHovered(word)}
                onMouseLeave={() => setHovered(null)}
                title={`${word} · 出现 ${count} 次`}
              >
                {word}
                {hovered === word && <em>×{count}</em>}
              </span>
            );
          })}
        </div>
      </div>

      <div className="cloud-stats">
        <div className="cloud-stat sketch-card"><TrendingUp size={18} /><div><strong>{words.length}</strong><span>个词</span></div></div>
        <div className="cloud-stat sketch-card"><Cloud size={18} /><div><strong>{words[0]?.[0] || "—"}</strong><span>最常出现</span></div></div>
        <div className="cloud-stat sketch-card"><Sparkles size={18} /><div><strong>{topics.length}</strong><span>张专辑</span></div></div>
      </div>
    </div>
  );
}
