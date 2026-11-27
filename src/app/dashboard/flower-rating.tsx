"use client";

// 童趣评分：不用五角星，改成会逐朵「绽放」的手绘小花。
// 与「听过的，慢慢长成自己」的生长意象呼应。卡片只读展示，弹窗可点选。

export const FLOWER_WORDS = ["", "打个照面", "有点意思", "听进心里", "余音绕梁", "反复回放"];

const PETALS = [0, 72, 144, 216, 288];

function Flower({ on, size, tilt }: { on: boolean; size: number; tilt: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 40 40"
      className={`flower-svg ${on ? "on" : "off"}`}
      style={{ transform: `rotate(${tilt}deg)` }}
      aria-hidden="true"
    >
      <g transform="translate(20 20)">
        {PETALS.map((deg) => (
          <ellipse
            key={deg}
            cx="0" cy="-9.5" rx="5.1" ry="8.2"
            transform={`rotate(${deg})`}
            className="flower-petal"
          />
        ))}
        <circle cx="0" cy="0" r="5.1" className="flower-core" />
      </g>
    </svg>
  );
}

/** 只读：用于卡片，紧凑 */
export function FlowerRatingReadonly({ value, size = 15 }: { value: number; size?: number }) {
  if (!value || value < 1) return null;
  return (
    <span className="flower-readonly" title={FLOWER_WORDS[value]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Flower key={n} on={n <= value} size={size} tilt={(n - 3) * 6} />
      ))}
    </span>
  );
}

/** 可点选：用于弹窗 */
export function FlowerRatingPicker({
  value, onChange, size = 34,
}: {
  value: number; onChange: (v: number) => void; size?: number;
}) {
  return (
    <div className="flower-picker">
      <div className="flower-picker-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`flower-btn ${n <= value ? "on" : ""}`}
            onClick={() => onChange(n === value ? n - 1 : n)}
            aria-label={`${n} 朵 · ${FLOWER_WORDS[n]}`}
            title={FLOWER_WORDS[n]}
          >
            <Flower on={n <= value} size={size} tilt={(n - 3) * 5} />
          </button>
        ))}
      </div>
      <span className="flower-word">{value ? `${value} 朵 · ${FLOWER_WORDS[value]}` : "点亮小花，记下喜爱"}</span>
    </div>
  );
}
