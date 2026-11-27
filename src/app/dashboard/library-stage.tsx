"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, X, LayoutGrid, List, Plus, Sparkles, Clock,
  ChevronDown, SlidersHorizontal, Headphones,
} from "lucide-react";
import type { Episode, Topic } from "./types";
import { ShowCover } from "./show-cover";
import { FlowerRatingReadonly, FLOWER_WORDS } from "./flower-rating";
import {
  GUEST_CARD, GUEST_QUOTES, GUEST_FACETS, GUEST_STATS,
  sourceUrlOf, displayCover, type Facet,
} from "@/lib/guest/data";

const PLATFORM_LABEL: Record<string, string> = {
  xiaoyuzhou: "小宇宙", bilibili: "B站", douyin: "抖音", xiaohongshu: "小红书", other: "链接",
};
const BASE_TILT = [-16, 12, -8, 15, -13, 9, -18, 11, -6, 17, -12, 7, -9, 14];

function fmtDur(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}小时${m % 60}分` : `${m}分钟`;
}

type Slot =
  | { kind: "ep"; key: string; ep: Episode }
  | { kind: "empty"; key: string };

type BookState = {
  x: number; y: number; z: number; rx: number; ry: number; rz: number;
  s: number; o: number; open: number;
  vx: number; vy: number; vz: number; vrx: number; vry: number;
  vrz: number; vs: number; vo: number; vopen: number;
};
function blankState(): BookState {
  return {
    x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 0.15, o: 0, open: 0,
    vx: 0, vy: 0, vz: 0, vrx: 0, vry: 0, vrz: 0, vs: 0, vo: 0, vopen: 0,
  };
}

const K = { x: 120, y: 120, z: 140, rx: 160, ry: 160, rz: 120, s: 170, o: 90, open: 110 };
const C = { x: 17, y: 17, z: 20, rx: 18, ry: 18, rz: 15, s: 21, o: 19, open: 20 };

type Props = {
  episodes: Episode[];
  topics: Topic[];
  emptyLibrary: boolean;
  topicFilter: string;
  onTopicFilter: (id: string) => void;
  onAdd: () => void;
  onExit: (mode: "grid" | "list") => void;
  query: string;
  searching: boolean;
};

export function LibraryStage(props: Props) {
  const {
    episodes, topics, emptyLibrary, topicFilter,
    onTopicFilter, onAdd, onExit, query, searching,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const [arrange, setArrange] = useState<"orbit" | "shelf">("orbit");
  const [focus, setFocus] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [facetOpen, setFacetOpen] = useState(false);
  const [facet, setFacet] = useState<{ type: "show" | "topic" | "platform" | "month"; key: string } | null>(null);
  const [miniIndex, setMiniIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [reduce, setReduce] = useState(false);

  // ---- 分面筛选：节目 / 专辑 / 平台 / 月份 ----
  const facetFiltered = useMemo(() => {
    if (!facet) return episodes;
    return episodes.filter((e) => {
      const card = GUEST_CARD[e.id];
      switch (facet.type) {
        case "show": return (card?.show ?? e.author ?? "") === facet.key;
        case "topic": return (topics.find((t) => t.id === e.topic_id)?.name ?? "") === facet.key;
        case "platform": return PLATFORM_LABEL[e.platform] === facet.key;
        case "month": return (e.added_at ?? e.created_at ?? "").startsWith(facet.key);
      }
    });
  }, [episodes, facet, topics]);

  const stats = GUEST_STATS;
  const facets = GUEST_FACETS;

  // ---- 环上的书：真实期 + 空位书 ----
  const slots: Slot[] = useMemo(() => {
    if (emptyLibrary && facetFiltered.length === 0) {
      return Array.from({ length: 12 }, (_, i) => ({ kind: "empty", key: `empty-${i}` }) as Slot);
    }
    const real: Slot[] = facetFiltered.slice(0, 14).map((ep) => ({ kind: "ep", key: ep.id, ep }));
    const min = Math.min(8, Math.max(real.length, 6));
    while (real.length < min) real.push({ kind: "empty", key: `empty-${real.length}` });
    return real;
  }, [facetFiltered, emptyLibrary]);

  // 书阵显示的条目（可「展开更多」）
  const shelfList = useMemo(
    () => (showAll ? facetFiltered : facetFiltered.slice(0, 24)),
    [facetFiltered, showAll]
  );

  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const focusRef = useRef(focus); focusRef.current = focus;
  const arrangeRef = useRef(arrange); arrangeRef.current = arrange;
  const reduceRef = useRef(reduce); reduceRef.current = reduce;
  const facetRef = useRef(facet); facetRef.current = facet;
  const elsRef = useRef<HTMLElement[]>([]);
  const statesRef = useRef<Map<string, BookState>>(new Map());
  const phaseRef = useRef(0);
  const phaseVRef = useRef(0);
  const pointerRef = useRef({ x: 0.5, y: 0.5, px: 0, py: 0, inside: false });
  const dragRef = useRef<{ i: number; sx: number; sy: number; lx: number; ly: number; vx: number; vy: number; moved: boolean } | null>(null);
  const focusAtRef = useRef(0);
  const introRef = useRef(0);

  useEffect(() => {
    elsRef.current = Array.from(stageRef.current?.querySelectorAll<HTMLElement>(".folio-book") ?? []);
  }, [slots]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setMiniIndex((v) => (v + 1) % Math.max(1, slotsRef.current.length)), 2600);
    return () => clearInterval(t);
  }, [reduce]);

  useEffect(() => {
    if (focus !== null) focusAtRef.current = performance.now();
  }, [focus]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Esc 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFocus(null); setFacetOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- 弧长参数化的圆角矩形环 ----
  const ringRef = useRef<{ key: string; pts: { x: number; y: number }[]; cum: number[]; total: number } | null>(null);
  function getRing(W: number, H: number, mobile: boolean) {
    const key = `${W}x${H}`;
    if (ringRef.current?.key === key) return ringRef.current;
    const a = W * (mobile ? 0.5 : 0.42);
    const b = H * (mobile ? 0.42 : 0.43);
    const N = 720;
    const pts: { x: number; y: number }[] = [];
    const cum: number[] = [0];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      pts.push({
        x: a * Math.sign(c) * Math.sqrt(Math.abs(c)),
        y: b * Math.sign(s) * Math.sqrt(Math.abs(s)),
      });
      if (i > 0) {
        const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
        cum.push(cum[i - 1] + Math.hypot(dx, dy));
      }
    }
    const ring = { key, pts, cum, total: cum[N] };
    ringRef.current = ring;
    return ring;
  }
  function posAt(ring: ReturnType<typeof getRing>, u: number) {
    const target = ((u % 1) + 1) % 1 * ring.total;
    let lo = 0, hi = ring.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ring.cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const seg = ring.cum[i] - ring.cum[i - 1] || 1;
    const f = (target - ring.cum[i - 1]) / seg;
    return {
      x: ring.pts[i - 1].x + (ring.pts[i].x - ring.pts[i - 1].x) * f,
      y: ring.pts[i - 1].y + (ring.pts[i].y - ring.pts[i - 1].y) * f,
    };
  }

  // ---- 单个 rAF 循环：spring 物理 + 3D transform ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastDims = "";

    const step = (now: number) => {
      const stage = stageRef.current;
      if (!stage) { raf = requestAnimationFrame(step); return; }
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const W = stage.clientWidth, H = stage.clientHeight;
      const mobile = W < 720;
      const bw = mobile ? Math.min(W * 0.28, 128) : Math.max(112, Math.min(178, W * 0.128));
      const bh = bw * 1.24;
      const d = bw * 0.085;
      const dimKey = `${bw.toFixed(0)}`;
      if (dimKey !== lastDims) {
        lastDims = dimKey;
        stage.style.setProperty("--bw", `${bw}px`);
        stage.style.setProperty("--bh", `${bh}px`);
        stage.style.setProperty("--bd", `${d}px`);
      }

      const slots = slotsRef.current;
      const n = slots.length || 1;
      const els = elsRef.current;
      const states = statesRef.current;
      const ring = getRing(W, H, mobile);
      const cx = W / 2, cy = H * (mobile ? 0.5 : 0.53);
      const focusIdx = focusRef.current;
      const isShelf = arrangeRef.current === "shelf";
      const reduced = reduceRef.current;
      const drag = dragRef.current;
      const ptr = pointerRef.current;

      // 自转：focus / 拖拽 / 书阵时暂停
      if (!reduced && focusIdx === null && !drag && !isShelf) {
        phaseRef.current += 0.035 * dt + phaseVRef.current * dt * 6;
        phaseVRef.current *= Math.pow(0.93, dt * 60);
      } else {
        phaseVRef.current *= Math.pow(0.9, dt * 60);
      }

      // 累计秒数（不再 clamp 到 1）：否则序号靠后的书会永远卡在入场动画里，
      // 放大展开时被自己的渐入系数压暗到看不见。
      introRef.current += dt;

      for (let i = 0; i < slots.length; i++) {
        const el = els[i];
        if (!el) continue;
        const key = slots[i].key;
        let p = states.get(key);
        if (!p) { p = blankState(); states.set(key, p); }
        const seed = (Math.sin(i * 91.7) * 0.5 + 0.5);
        const depth = 0.6 + seed * 0.8;

        // --- 目标位 ---
        let tx: number, ty: number, tz = 0, ts = 1, to = 1;
        let trx = 0, try_ = 0, trz = BASE_TILT[i % BASE_TILT.length] + Math.sin(t * 0.5 + i) * 2;
        let topen = 0;

        if (isShelf) {
          tx = cx; ty = cy; tz = -260; ts = 0.36; to = 0;
        } else if (drag && drag.i === i) {
          tx = drag.lx; ty = drag.ly; tz = 110; ts = 1.1;
          trz = BASE_TILT[i % BASE_TILT.length] + drag.vx * 2.2;
          try_ = drag.vx * 3; trx = -drag.vy * 3;
        } else if (focusIdx !== null && i === focusIdx) {
          const s = Math.min(1.85, (H * 0.44) / bh);
          tx = cx + bw * 0.28; ty = cy; tz = 170; ts = s; to = 1;
          trx = 0; try_ = -9; trz = 0;
          // 先飞到中间，再 unfold
          topen = now - focusAtRef.current > 260 ? 0.94 : 0.05;
        } else if (focusIdx !== null) {
          const u = ((phaseRef.current / (Math.PI * 2) + i / n) % 1 + 1) % 1;
          const rp = posAt(ring, u);
          tx = cx + (cx + rp.x - cx) * 1.42;
          ty = cy + (cy + rp.y - cy) * 1.42;
          tz = -60; ts = 0.86; to = 0.16;
        } else {
          const u = ((phaseRef.current / (Math.PI * 2) + i / n) % 1 + 1) % 1;
          const rp = posAt(ring, u);
          tx = cx + rp.x;
          ty = cy + rp.y;
          if (!reduced) {
            tx += (ptr.x - 0.5) * -38 * depth;
            ty += (ptr.y - 0.5) * -26 * depth + Math.sin(t * 0.7 + i * 1.7) * 5;
            trx = (ptr.y - 0.5) * -16;
            try_ = (ptr.x - 0.5) * 22;
            // 指针靠近时轻轻推开
            if (ptr.inside) {
              const dx = tx - ptr.px, dy = ty - ptr.py;
              const dist = Math.hypot(dx, dy) || 1;
              if (dist < bw * 1.25) {
                const push = (1 - dist / (bw * 1.25)) * bw * 0.35;
                tx += (dx / dist) * push; ty += (dy / dist) * push;
              }
            }
          }
          // hover 微启
          if (el.matches(":hover") && !reduced) { tz = 60; ts = 1.06; trz *= 0.45; topen = 0.05; }
        }

        // --- spring 积分（4 子步）---
        if (reduced) {
          p.x = tx; p.y = ty; p.z = tz; p.rx = trx; p.ry = try_; p.rz = trz;
          p.s = ts; p.o = to; p.open = topen;
        } else {
          const sub = dt / 4;
          for (let k = 0; k < 4; k++) {
            const acc = (target: number, cur: number, vel: number, stiff: number, damp: number) =>
              (target - cur) * stiff - vel * damp;
            p.vx += acc(tx, p.x, p.vx, K.x, C.x) * sub; p.x += p.vx * sub;
            p.vy += acc(ty, p.y, p.vy, K.y, C.y) * sub; p.y += p.vy * sub;
            p.vz += acc(tz, p.z, p.vz, K.z, C.z) * sub; p.z += p.vz * sub;
            p.vrx += acc(trx, p.rx, p.vrx, K.rx, C.rx) * sub; p.rx += p.vrx * sub;
            p.vry += acc(try_, p.ry, p.vry, K.ry, C.ry) * sub; p.ry += p.vry * sub;
            p.vrz += acc(trz, p.rz, p.vrz, K.rz, C.rz) * sub; p.rz += p.vrz * sub;
            p.vs += acc(ts, p.s, p.vs, K.s, C.s) * sub; p.s += p.vs * sub;
            p.vo += acc(to, p.o, p.vo, K.o, C.o) * sub; p.o += p.vo * sub;
            p.vopen += acc(topen, p.open, p.vopen, K.open, C.open) * sub; p.open += p.vopen * sub;
          }
        }

        const appear = Math.min(1, Math.max(0, (introRef.current - 0.12 - i * 0.07) / 0.5));
        el.style.opacity = String(Math.max(0, Math.min(1, p.o * appear)));
        el.style.zIndex = String(1000 + Math.round(p.z));
        el.style.transform =
          `translate3d(${(p.x - bw / 2).toFixed(2)}px, ${(p.y - bh / 2).toFixed(2)}px, ${p.z.toFixed(2)}px) ` +
          `rotateZ(${p.rz.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) scale(${p.s.toFixed(3)})`;
        el.style.setProperty("--open", p.open.toFixed(3));
        el.style.setProperty("--gz", String(Math.max(0, p.z / 200)));
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 滚轮转环（非被动监听）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (arrangeRef.current !== "orbit" || focusRef.current !== null) return;
      e.preventDefault();
      phaseVRef.current += Math.max(-3, Math.min(3, e.deltaY * 0.002));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- 指针 / 拖拽 ----
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const ptr = pointerRef.current;
    ptr.x = px / r.width; ptr.y = py / r.height; ptr.px = px; ptr.py = py; ptr.inside = true;
    const drag = dragRef.current;
    if (drag) {
      const dx = px - drag.sx, dy = py - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
      drag.vx = (px - drag.lx) * 0.06;
      drag.vy = (py - drag.ly) * 0.06;
      drag.lx = px; drag.ly = py;
    }
  }
  function onBookDown(i: number, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = {
      i, sx: e.clientX - r.left, sy: e.clientY - r.top,
      lx: e.clientX - r.left, ly: e.clientY - r.top, vx: 0, vy: 0, moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      const key = slots[drag.i]?.key;
      const p = key ? statesRef.current.get(key) : null;
      if (p) { p.vx = drag.vx * 60; p.vy = drag.vy * 60; p.vrz = drag.vx * 18; }
      setToast(["扔得漂亮，它总会回来。", "慢一点，书会自己归位。", "书架接住了。"][Math.floor(Math.random() * 3)]);
      setFocus(null);
    } else {
      // 触屏点一下先展开，再点一次进详情
      if (focus === drag.i) {
        const s = slots[drag.i];
        if (s?.kind === "ep") window.location.href = `/episode/${s.ep.id}`;
        else onAdd();
      } else {
        setFocus(drag.i);
      }
    }
  }

  function shuffle() {
    phaseVRef.current += 1.6;
    statesRef.current.forEach((p) => { p.vrz += (Math.random() - 0.5) * 160; p.vz += 60; });
    setToast("书架洗过了，顺序换了换。");
  }

  function onFacetPick(type: "show" | "topic" | "platform" | "month", key: string) {
    if (type === "topic") {
      const t = topics.find((x) => x.name === key);
      if (t) { onTopicFilter(t.id); setFacet(null); setFocus(null); return; }
    }
    setFacet((cur) => (cur?.type === type && cur.key === key ? null : { type, key }));
    setFocus(null);
  }

  const focusSlot = focus !== null ? slots[focus] : null;
  const focusEp = focusSlot?.kind === "ep" ? focusSlot.ep : null;
  const focusCard = focusEp ? GUEST_CARD[focusEp.id] : null;
  const focusQuotes = focusEp ? (GUEST_QUOTES[focusEp.id] ?? []) : [];
  const topicOf = (ep: Episode) => topics.find((t) => t.id === ep.topic_id)?.name ?? "拾光杂记";

  const articleCount = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem("pm_guest_transcripts_v1") || "{}") as Record<string, { article?: unknown }>;
      return Object.values(raw).filter((t) => t && t.article).length;
    } catch {
      return 0;
    }
  })();
  const archiveLine = `${episodes.length} 期声音 · ${articleCount} 篇知识文章`;

  return (
    <div
      ref={stageRef}
      className={`folio-stage ${arrange === "shelf" ? "is-shelf" : ""} ${focus !== null ? "is-focus" : ""} ${reduce ? "is-reduced" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => { pointerRef.current.inside = false; if (focusRef.current !== null) setFocus(null); }}
    >
      {/* 左上：视角切换 */}
      <div className="folio-switch folio-switch-top">
        <button className={arrange === "orbit" ? "active" : ""} onClick={() => { setArrange("orbit"); setFocus(null); }}>环绕</button>
        <button className={arrange === "shelf" ? "active" : ""} onClick={() => { setArrange("shelf"); setFocus(null); }}>书阵 <em>{facetFiltered.length}</em></button>
        <button onClick={() => onExit("grid")}><LayoutGrid size={14} /> 网格</button>
        <button onClick={() => onExit("list")}><List size={14} /> 列表</button>
      </div>

      {/* 中央文案 */}
      <div className="folio-copy">
        <div className="folio-kicker">
          <span>THE KNOWLEDGE ARCHIVE</span>
          <button className="folio-mini" onClick={shuffle} title="把书架顺序洗一洗" aria-label="洗牌">
            <span key={miniIndex}><ShowCover data={{ coverUrl: null, seed: miniIndex, title: "", show: "声", no: "" }} /></span>
          </button>
        </div>
        <h1 className="brush-title archive-hero">
          <Reveal text="让每一份知识，" start={60} />
          <em><Reveal text="都有迹可循。" start={300} /></em>
        </h1>
        <p className="folio-desc">一座开放的知识档案馆，汇集来自不同领域的声音、观点与故事。</p>
        <p className="folio-stats">{archiveLine}</p>
        <p className="folio-close">从多元的声音中，看见更广阔的世界。</p>
        <div className="folio-actions">
          <button className="folio-cta" onClick={onAdd}>粘一条链接 <ArrowUpRight size={16} /></button>
          <button className="folio-facet-btn" onClick={() => setFacetOpen((v) => !v)}>
            <SlidersHorizontal size={14} /> 按节目 / 专辑 / 平台 / 月份翻
          </button>
        </div>
      </div>

      {/* 分面筛选面板 */}
      {facetOpen && (
        <div className="folio-facets">
          {([
            ["show", "节目", facets.show],
            ["topic", "专辑", facets.topic],
            ["platform", "平台", facets.platform],
            ["month", "月份", facets.month],
          ] as const).map(([type, label, list]) => (
            <div className="ff-row" key={type}>
              <span className="ff-label">{label}</span>
              <div className="ff-chips">
                {list.length === 0 && <span className="ff-none">待补</span>}
                {list.map((f: Facet) => (
                  <button
                    key={f.key}
                    className={`ff-chip ${facet?.type === type && facet.key === f.key ? "active" : ""}`}
                    onClick={() => onFacetPick(type, f.key)}
                  >
                    {f.label}<em>{f.count}</em>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button className="ff-clear" onClick={() => { setFacet(null); onTopicFilter("all"); setFacetOpen(false); }}>清除筛选 <X size={12} /></button>
          {facet && <span className="ff-result">筛到 {facetFiltered.length} 期</span>}
        </div>
      )}

      {/* 3D 环绕书 */}
      <div className="folio-books">
        {slots.map((slot, i) => {
          const ep = slot.kind === "ep" ? slot.ep : null;
          const card = ep ? GUEST_CARD[ep.id] : null;
          const quotes = ep ? (GUEST_QUOTES[ep.id] ?? []) : [];
          return (
            <div
              key={slot.key}
              className={`folio-book ${slot.kind === "empty" ? "is-empty" : ""} ${focus === i ? "is-open" : ""}`}
              onPointerEnter={() => { if (!dragRef.current) setFocus(i); }}
              onPointerDown={(e) => onBookDown(i, e)}
            >
              <div className="folio-floor" />
              <div className="folio-b3d">
                <div className="fb-face fb-front">
                  <div className="fb-cv">
                    {slot.kind === "ep" ? (
                      <ShowCover data={{ coverUrl: displayCover(ep!), seed: i, title: ep!.title, show: card?.show ?? ep!.author ?? "播客", no: ep!.episode_no ?? card?.no }} />
                    ) : (
                      <ShowCover data={{ coverUrl: null, seed: i, title: "", show: "", no: "空位", empty: true }} />
                    )}
                    <div className="fb-sheen" />
                    {ep && <span className="fb-chip"><i />{PLATFORM_LABEL[ep.platform] ?? "链接"}</span>}
                  </div>
                  <div className="fb-inside" />
                </div>

                <div className="fb-face fb-page">
                  {ep ? (
                    <div className="fp-inner">
                      <div className="fp-top">
                        <span>{card?.no ?? ep.episode_no ?? "这一期"}</span>
                        <span>{PLATFORM_LABEL[ep.platform]}{ep.duration_sec ? ` · ${fmtDur(ep.duration_sec)}` : ""}</span>
                      </div>
                      <h3>{ep.title}</h3>
                      <p className="fp-show">{card?.show ?? ep.author ?? "播客"} · {topicOf(ep)}</p>
                      <div className="fp-rule" />
                      {ep.summary ? <p className="fp-blurb">{ep.summary}</p> : (
                        <p className="fp-blurb dim">这一期还没有写下简介。翻开它，留一句自己的话。</p>
                      )}
                      {quotes.length > 0 && (
                        <div className="fp-quotes">
                          {quotes.slice(0, 2).map((q, k) => <p key={k}>「{q}」</p>)}
                        </div>
                      )}
                      {(ep.rating ?? 0) > 0 && (
                        <div className="fp-rating"><FlowerRatingReadonly value={ep.rating ?? 0} size={12} /><span>{FLOWER_WORDS[ep.rating ?? 0]}</span></div>
                      )}
                      {ep.note && <p className="fp-note">余音：{ep.note}</p>}
                      <div className="fp-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                        {sourceUrlOf(ep.id) && <a href={sourceUrlOf(ep.id)!} target="_blank" rel="noreferrer">去原平台收听 ↗</a>}
                        <Link href={`/episode/${ep.id}`} className="fp-open">翻开这一期 <ArrowUpRight size={13} /></Link>
                      </div>
                    </div>
                  ) : (
                    <div className="fp-inner fp-empty">
                      <div className="fp-empty-mark"><Plus size={26} /></div>
                      <h3>这里还空着</h3>
                      <p>粘一条播客链接，让它在这儿安个位置。</p>
                      <button onClick={onAdd}>放一期进来 <ArrowUpRight size={13} /></button>
                    </div>
                  )}
                </div>

                <div className="fb-face fb-back" />
                <div className="fb-face fb-spine" />
                <div className="fb-face fb-foreedge" />
                <div className="fb-face fb-top" />
                <div className="fb-face fb-bottom" />
              </div>
            </div>
          );
        })}
      </div>

      {/* 聚焦时的收起控件 */}
      {focus !== null && (
        <div className="folio-focus-ui">
          <button className="ff-close" onClick={() => setFocus(null)}><X size={15} /> 收起</button>
          <span>{focusEp ? "再点一次封面，或按「翻开这一期」进去" : "点一下就能放一期进来"}</span>
        </div>
      )}

      {/* 密集书阵（借鉴索引站：一次铺满、带计数、可展开更多） */}
      {arrange === "shelf" && (
        <div className="folio-shelf">
          <div className="fs-head">
            <span>全部 {facetFiltered.length} 期{facet ? ` · ${facet.key}` : ""}</span>
            {searching && <span className="fs-searching">正在全库翻找…</span>}
            {query && !searching && <span className="fs-searching">「{query}」翻到 {facetFiltered.length} 期</span>}
          </div>
          {facetFiltered.length === 0 ? (
            <div className="fs-empty">
              <Headphones size={26} strokeWidth={1.4} />
              <p>{emptyLibrary ? "清单还没给到，先粘一条链接试试。" : "没翻到相符的内容，换个词再找找。"}</p>
              <button onClick={onAdd}>粘一条链接 <Plus size={14} /></button>
            </div>
          ) : (
            <>
              <div className="fs-grid">
                {shelfList.map((ep, i) => {
                  const card = GUEST_CARD[ep.id];
                  return (
                    <Link href={`/episode/${ep.id}`} className="fs-card" key={ep.id} style={{ animationDelay: `${Math.min(i, 20) * 24}ms` }}>
                      <div className="fs-cover">
                        <ShowCover data={{ coverUrl: displayCover(ep), seed: i, title: ep.title, show: card?.show ?? ep.author ?? "播客", no: ep.episode_no ?? "" }} />
                        <span className="fs-platform">{PLATFORM_LABEL[ep.platform]}</span>
                      </div>
                      <h4 title={ep.title}>{ep.title}</h4>
                      <p>{card?.show ?? ep.author ?? "播客"}</p>
                      <div className="fs-foot"><span>{topicOf(ep)}</span>{ep.duration_sec ? <span><Clock size={10} />{fmtDur(ep.duration_sec)}</span> : null}</div>
                    </Link>
                  );
                })}
              </div>
              {facetFiltered.length > 24 && (
                <button className="fs-more" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "收起" : `展开其余 ${facetFiltered.length - 24} 期`} <ChevronDown size={14} className={showAll ? "flip" : ""} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 底部控件 */}
      <div className="folio-bottom">
        <span className="folio-hint">拖动可以抛一抛 · 滚轮转动书架 · 停在一本上，它会浮到中间翻开</span>
      </div>

      {toast && <div className="folio-toast">{toast}</div>}
    </div>
  );
}

/** 中文逐字从遮罩下升起；楷体的撇捺留一点余量 */
function Reveal({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span className="reveal-mask" key={`${ch}-${i}`}>
          <span className="reveal-ch" style={{ animationDelay: `${start + i * 52}ms` }}>{ch}</span>
        </span>
      ))}
    </>
  );
}
