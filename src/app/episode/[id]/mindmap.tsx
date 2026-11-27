"use client";

import { useMemo, useState } from "react";
import { Sparkles, CornerDownRight, Layers, ChevronDown } from "lucide-react";

type Node = { name: string; start_ms?: number; children?: Node[] };

const COLORS = ["#7d6bab", "#6f8fa8", "#b98a86", "#8aa387", "#c0a06a", "#a97b93"];
const COL_W = [206, 268, 288, 316];
const ROW_H = 78;
const NODE_H = 66;
const GAP_Y = 5;
const COL_GAP = 46;
const MAX_DEPTH = 3; // root + 三级

type Placed = {
  id: string;
  name: string;
  start_ms?: number;
  depth: number;
  x: number;
  y: number;
  color: string;
  parentId?: string;
  hasKids: boolean;
};

/**
 * 一集播客的思维导图：横向多层树（根 → 议题 → 论点 → 论据）。
 * 不用第三方图库，绝对定位 + 贝塞尔连线；点二级及以下，跳回逐字稿那段并开始播放。
 */
export function MindMap({ data, onSeek }: { data: Node; onSeek?: (ms: number, jump?: boolean) => void }) {
  const [deep, setDeep] = useState(true);
  const [openNode, setOpenNode] = useState<string | null>(null);

  const { placed, width, height } = useMemo(() => {
    const X = [0];
    for (let i = 1; i < COL_W.length; i++) X.push(X[i - 1] + COL_W[i - 1] + COL_GAP);

    const maxDepth = deep ? MAX_DEPTH : 2;
    const out: Placed[] = [];
    let cursor = 0;

    function walk(node: Node, depth: number, color: string, id: string, parentId?: string): number {
      const kids = node.children ?? [];
      const expand = depth < maxDepth && kids.length > 0;
      let y: number;

      if (expand) {
        const ys = kids.slice(0, 5).map((k, i) => walk(k, depth + 1, color, `${id}.${i}`, id));
        y = (Math.min(...ys) + Math.max(...ys)) / 2;
      } else {
        y = cursor + ROW_H / 2;
        cursor += ROW_H + GAP_Y;
      }

      out.push({ id, name: node.name, start_ms: node.start_ms, depth, x: X[depth], y, color, parentId, hasKids: expand });
      return y;
    }

    const branches = (data.children ?? []).slice(0, 5);
    const ys = branches.map((b, i) => walk(b, 1, COLORS[i % COLORS.length], `b${i}`, "root"));
    const rootY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : ROW_H / 2;

    out.push({
      id: "root",
      name: data.name,
      start_ms: data.start_ms,
      depth: 0,
      x: X[0],
      y: rootY,
      color: COLORS[0],
      hasKids: true,
    });

    const maxDepthUsed = out.reduce((m, p) => Math.max(m, p.depth), 0);
    return {
      placed: out,
      width: X[Math.min(maxDepthUsed, COL_W.length - 1)] + COL_W[Math.min(maxDepthUsed, COL_W.length - 1)],
      height: Math.max(cursor - GAP_Y, ROW_H),
    };
  }, [data, deep]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const hasDeep = useMemo(() => {
    const scan = (n: Node, d: number): boolean =>
      d >= 2 ? (n.children?.length ?? 0) > 0 : (n.children ?? []).some((c) => scan(c, d + 1));
    return scan(data, 0);
  }, [data]);

  return (
    <section className="detail-mindmap sketch-card">
      <div className="sketch-sticky warm">导图</div>
      <div className="mindmap-head">
        <h2><Sparkles size={18} /> 这期的骨架</h2>
        <div className="mindmap-head-right">
          <span className="mindmap-hint"><CornerDownRight size={12} /> 点二级及以下，跳到那段并播放</span>
          {hasDeep && (
            <button className={`mindmap-deep ${deep ? "on" : ""}`} onClick={() => setDeep((v) => !v)}>
              <Layers size={12} /> {deep ? "只看骨架" : "展开细节"}
              <ChevronDown size={12} className={deep ? "up" : ""} />
            </button>
          )}
        </div>
      </div>

      {openNode && (
        <div className="mindmap-detail">
          <span className="md-label">节点全文</span>
          <p>{placed.find((p) => p.id === openNode)?.name}</p>
          <button onClick={() => setOpenNode(null)} aria-label="关闭">×</button>
        </div>
      )}

      <div className="mindmap-scroll">
        <div className="mindmap-canvas" style={{ width, height }}>
          <svg className="mindmap-lines" width={width} height={height} aria-hidden="true">
            {placed.map((p) => {
              if (!p.parentId) return null;
              const parent = byId.get(p.parentId);
              if (!parent) return null;
              const x1 = parent.x + COL_W[parent.depth];
              const y1 = parent.y;
              const x2 = p.x;
              const y2 = p.y;
              const mx = x1 + (x2 - x1) * 0.55;
              return (
                <path
                  key={`line-${p.id}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  stroke={p.color}
                  strokeWidth={p.depth <= 2 ? 1.7 : 1.2}
                  fill="none"
                  opacity={p.depth <= 2 ? 0.5 : 0.34}
                />
              );
            })}
          </svg>

          {placed.map((p) => {
            const seekable = p.start_ms != null;
            return (
              <button
                key={p.id}
                type="button"
                className={`mind-node mind-d${p.depth} ${seekable ? "seekable" : ""}`}
                style={{
                  left: p.x,
                  top: p.y - NODE_H / 2,
                  width: COL_W[p.depth],
                  ...(p.depth === 0 ? {} : { borderColor: p.color }),
                  color: p.depth === 0 ? "#fff" : p.color,
                }}
                onClick={() => setOpenNode(p.id)}
                title={seekable ? "跳到这一段并播放" : p.name}
                disabled={!seekable}
              >
                {p.depth === 0 ? (
                  <>
                    <span className="mind-node-root-label">本集</span>
                    <span className="mind-node-root-name">{p.name}</span>
                  </>
                ) : (
                  <>
                    {p.depth === 1 && <i style={{ background: p.color }} />}
                    <span className="mind-node-text">{p.name}</span>
                    {seekable && p.depth >= 2 && <CornerDownRight size={11} className="mind-node-go" />}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
