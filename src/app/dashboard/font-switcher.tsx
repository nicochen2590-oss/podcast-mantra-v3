"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";

/**
 * 字体设置：正文固定用「得意黑」，大标题可切「云风汉禅」。
 * 品牌字标（开屏 Podcast Mantra / 首页 Mantra）永远不参与。
 */
const BODY = "smiley";
const HEAD_KEY = "pm_heading_font";

type HeadingKey = "default" | "yf";

export function applyFonts(heading: HeadingKey) {
  document.documentElement.dataset.font = BODY;
  document.documentElement.dataset.heading = heading;
}

export function FontSwitcher() {
  const [heading, setHeading] = useState<HeadingKey>("default");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem(HEAD_KEY) as HeadingKey | null) ?? "default";
    setHeading(saved);
    applyFonts(saved);
  }, []);

  function pick(k: HeadingKey) {
    setHeading(k);
    applyFonts(k);
    try { localStorage.setItem(HEAD_KEY, k); } catch { /* 忽略 */ }
    setOpen(false);
  }

  return (
    <div className="font-switch">
      {open && (
        <div className="fs-menu">
          <div className="fs-title">正文字体</div>
          <div className="fs-locked">得意黑 · 已固定</div>
          <div className="fs-title" style={{ paddingTop: 12 }}>大标题</div>
          <button className={`fs-item ${heading === "default" ? "on" : ""}`} onClick={() => pick("default")}>
            <span className="fs-name">默认（同正文）</span>
            <span className="fs-desc">统一、克制</span>
          </button>
          <button className={`fs-item ${heading === "yf" ? "on" : ""}`} onClick={() => pick("yf")}>
            <span className="fs-name" style={{ fontFamily: '"YunFengHanChan"' }}>云风汉禅</span>
            <span className="fs-desc">只用于大标题，禅意书法</span>
          </button>
        </div>
      )}
      <button className="fs-btn" onClick={() => setOpen((v) => !v)} title="字体设置">
        <Type size={13} /> <span>Aa</span>
      </button>
    </div>
  );
}
