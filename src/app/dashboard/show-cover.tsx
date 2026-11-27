/**
 * 播客封面（通用）。
 * 有真实 cover_url 就直接显示图片；没有则生成一张纸面占位封面，
 * 用于清单还没给到时的「空位书」，以及用户自制条目缺封面的情况。
 * 占位封面完全由 CSS 生成，不引用任何第三方图片。
 */
import type { CSSProperties } from "react";

const PALETTES: [string, string, string][] = [
  ["#e8e3f2", "#6f6a9c", "#b9a8dc"],
  ["#dfeaf0", "#4a7186", "#9ec6d8"],
  ["#e6efe4", "#4f7a5c", "#a9cfae"],
  ["#f3e3d8", "#a2654a", "#e0b59c"],
  ["#f2e0e6", "#9c5a73", "#e3adbe"],
  ["#f5ecd2", "#9a7b34", "#e6cf8f"],
  ["#e4e7ee", "#4c5573", "#a7b0cc"],
  ["#efe6dc", "#7a6248", "#cbb49a"],
  ["#e2eeea", "#3f7d72", "#9fd2c6"],
  ["#efe4e8", "#8a4f5e", "#d8a7b2"],
];

export type ShowCoverData = {
  coverUrl?: string | null;
  seed: number;
  title: string;
  show: string;
  no?: string;
  empty?: boolean;
};

export function ShowCover({ data, className = "" }: { data: ShowCoverData; className?: string }) {
  if (data.coverUrl) {
    return (
      <div className={`show-cover has-image ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={data.coverUrl} alt="" draggable={false} loading="lazy" />
      </div>
    );
  }

  const [bg, ink, soft] = PALETTES[data.seed % PALETTES.length];
  const motif = data.seed % 4;
  const glyph = data.empty ? "＋" : (Array.from(data.show)[0] || "声");
  const style = { "--sc-bg": bg, "--sc-ink": ink, "--sc-soft": soft } as CSSProperties;

  return (
    <div className={`show-cover placeholder ${className}`} style={style} aria-hidden="true">
      <div className="sc-grain" />
      {motif === 0 && <div className="sc-ring"><i /><i /><i /></div>}
      {motif === 1 && <div className="sc-waves"><i /><i /><i /><i /><i /></div>}
      {motif === 2 && <div className="sc-grid" />}
      {motif === 3 && <div className="sc-arc" />}
      <div className="sc-glyph">{glyph}</div>
      <div className="sc-foot">
        <span className="sc-no">{data.no ?? "—"}</span>
        <span className="sc-show">{data.empty ? "等你放一期进来" : data.show}</span>
      </div>
      <div className="sc-edge" />
    </div>
  );
}
