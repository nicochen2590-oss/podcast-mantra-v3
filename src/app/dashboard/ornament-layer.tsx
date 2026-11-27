"use client";

import { useEffect, useRef } from "react";

/**
 * 内页的「书房浮物」：四张植物/器物插画散在主区边缘，缓慢漂浮，
 * 并随指针做弹簧视差（近层动得多、远层动得少）。
 * 只挂在 dashboard 主区，pointer-events 全关，不参与任何交互；
 * 尊重 prefers-reduced-motion，指针非精确设备（触屏）不启用视差。
 */

type Motion = "a" | "b" | "c" | "sway";

type Piece = {
  src: string;
  cls: string;
  depth: number;
  delay: number;
  motion: Motion;
  dur: number;
  rot: number;
  op: number;
};

// 只留植物与羽毛（捕梦网、贝壳已按设计意见移除）：尺寸接近、色调一致、都收在下半部，
// 上半部留给标题，不再四散抢眼。
const PIECES: Piece[] = [
  // 素材待更换：新的装饰上传后在这里加一条即可
];

const MOTES = [
  { l: 9, t: 72, s: 7, d: 17, delay: -3 },
  { l: 24, t: 84, s: 5, d: 21, delay: -11 },
  { l: 43, t: 68, s: 8, d: 19, delay: -6 },
  { l: 61, t: 80, s: 6, d: 23, delay: -14 },
  { l: 78, t: 70, s: 9, d: 16, delay: -2 },
  { l: 91, t: 86, s: 6, d: 20, delay: -8 },
];

export function OrnamentLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    const items = Array.from(layer.querySelectorAll<HTMLElement>(".orn-item[data-depth]"));

    let tx = 0, ty = 0;      // 指针目标（-1 ~ 1）
    let px = 0, py = 0;      // 弹簧当前值
    let vx = 0, vy = 0;      // 速度
    let raf = 0;
    let last = 0;

    const paint = () => {
      for (const el of items) {
        const d = Number(el.dataset.depth || 0);
        el.style.transform = `translate3d(${(-px * d).toFixed(2)}px, ${(-py * d * 0.5).toFixed(2)}px, 0)`;
      }
    };

    const clear = () => {
      for (const el of items) el.style.transform = "";
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const K = 46, C = 19;
      vx += ((tx - px) * K - vx * C) * dt;
      vy += ((ty - py) * K - vy * C) * dt;
      px += vx * dt;
      py += vy * dt;
      paint();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const configure = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      tx = ty = px = py = vx = vy = 0;
      if (!reduce.matches && fine.matches) {
        window.addEventListener("pointermove", onMove, { passive: true });
        last = performance.now();
        raf = requestAnimationFrame(tick);
      } else {
        clear();
      }
    };

    configure();
    reduce.addEventListener("change", configure);
    fine.addEventListener("change", configure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      reduce.removeEventListener("change", configure);
      fine.removeEventListener("change", configure);
    };
  }, []);

  return (
    <div className="orn-layer" ref={ref} aria-hidden="true">
      {PIECES.map((p, i) => (
        <div
          key={`${p.cls}-${i}`}
          className={`orn-item ${p.cls}`}
          data-depth={p.depth}
          style={{ animationDelay: `${p.delay}ms` } as React.CSSProperties}
        >
          <div
            className={`orn-art orn-${p.motion}`}
            style={{
              animationDuration: `${p.dur}s`,
              "--orn-rot": `${p.rot}deg`,
              "--orn-op": p.op,
            } as React.CSSProperties}
          >
            <img src={p.src} alt="" draggable={false} />
          </div>
        </div>
      ))}

      {MOTES.map((m, i) => (
        <span
          key={`mote-${i}`}
          className="orn-mote"
          style={{
            left: `${m.l}%`,
            top: `${m.t}%`,
            width: `${m.s}px`,
            height: `${m.s}px`,
            animationDuration: `${m.d}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
