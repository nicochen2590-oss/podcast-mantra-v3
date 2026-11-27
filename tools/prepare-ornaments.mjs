/**
 * 把用户提供的 4 张插画素材处理成「干净透明」的装饰素材。
 * 可复现：改参数后重跑即可，输出覆盖 public/ornaments/。
 *
 *   node tools/prepare-ornaments.mjs
 *
 * 处理思路（每张图底色/主体不同，分别定制）：
 *  - 风信子 JPG：白底 #f6f6f4 + 斜向浅灰水印，均为「高亮度 + 低色度」，按色度/亮度抠掉。
 *  - 扇贝   JPG：纯白底，主体是米金色，按「离纯白的距离 + 色度」抠掉。
 *  - 羽毛 / 捕梦网 PNG：透明棋盘格被截屏画成了 239/255 两值中性灰白格，
 *    主体也是白色，所以只清掉「严格中性 + 精确等于格子色」的像素，
 *    靠主体自带的蓝灰调 / 木色 / 纹理把它留下来。
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = "/Users/yina/.workbuddy/clipboard-images/";
const OUT = path.resolve("public/ornaments");
fs.mkdirSync(OUT, { recursive: true });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const FILES = [
  {
    src: "clipboard-2026-11-19T08-02-55-521Z-b96710e7.jpg",
    out: "hyacinth.webp", max: 560,
    alpha: ({ v, chroma }) => {
      if (v > 215 && chroma < 9) return 0;            // 白底 + 浅灰水印
      const byChroma = smooth(4, 24, chroma);
      const byDark = smooth(252, 205, v);             // 越暗越实（绿叶/花蕊）
      return 255 * Math.max(byChroma, byDark * 0.85);
    },
  },
  {
    src: "clipboard-2026-11-19T08-02-55-523Z-a647e0f0.jpg",
    out: "shell.webp", max: 820,
    alpha: ({ v, chroma }) => {
      if (v >= 250 && chroma < 10) return 0;          // 纯白底
      const byDark = smooth(250, 215, v);
      const byChroma = smooth(3, 22, chroma);
      return 255 * clamp(Math.max(byDark, byChroma * 0.9), 0, 1);
    },
  },
  {
    src: "clipboard-2026-11-19T08-02-55-525Z-1cf76768.png",
    out: "feather.webp", max: 620, gridClean: true,
    alpha: ({ v, chroma }) => {
      const d = Math.min(Math.abs(v - 239), Math.abs(v - 255));
      if (chroma < 3 && d < 9) return 0;              // 棋盘格 + 其边界抗锯齿
      // 中性白（蕾丝/羽轴）本身带纹理，稍微压淡，避免格子线残留
      const penalty = chroma < 3 ? 0.42 : 1;
      return 255 * smooth(0.06, 0.55, d / 26 + chroma / 20) * penalty;
    },
  },
  {
    src: "clipboard-2026-11-19T08-02-55-526Z-19d56047.png",
    out: "dreamcatcher.webp", max: 620, gridClean: true,
    alpha: ({ v, chroma }) => {
      const d = Math.min(Math.abs(v - 239), Math.abs(v - 255));
      if (chroma < 3 && d < 9) return 0;
      const penalty = chroma < 3 ? 0.42 : 1;
      return 255 * smooth(0.06, 0.55, d / 26 + chroma / 20) * penalty;
    },
  },
];

async function run(item) {
  const { data, info } = await sharp(SRC + item.src)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const buf = Buffer.alloc(w * h * 4);
  const neutral = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = data[i * c], g = data[i * c + 1], b = data[i * c + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const chroma = mx - mn;
      const a = clamp(Math.round(item.alpha({
        r, g, b, v: (r + g + b) / 3, chroma, mx, mn,
      })), 0, 255);
      const o = i * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
      neutral[i] = chroma < 6 ? 1 : 0;
    }
  }

  // 棋盘格边界的抗锯齿会留下贯通整行/整列的浅灰淡线。
  // 只清「整行几乎全是中性低 alpha」的条带，主体自带纹理不会被命中。
  if (item.gridClean) {
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) {
        const a = buf[(y * w + x) * 4 + 3];
        if (neutral[y * w + x] && a > 2 && a < 150) n++;
      }
      if (n > w * 0.55) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (neutral[i] && buf[i * 4 + 3] < 150) buf[i * 4 + 3] = 0;
      }
    }
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) {
        const a = buf[(y * w + x) * 4 + 3];
        if (neutral[y * w + x] && a > 2 && a < 150) n++;
      }
      if (n > h * 0.55) for (let y = 0; y < h; y++) {
        const i = y * w + x;
        if (neutral[i] && buf[i * 4 + 3] < 150) buf[i * 4 + 3] = 0;
      }
    }
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const pad = 12;
  const left = clamp(minX - pad, 0, w - 1);
  const top = clamp(minY - pad, 0, h - 1);
  const cw = clamp(maxX - minX + 1 + pad * 2, 1, w - left);
  const ch = clamp(maxY - minY + 1 + pad * 2, 1, h - top);

  const scale = item.max / Math.max(cw, ch);
  const tw = Math.round(cw * Math.min(1, scale));
  const th = Math.round(ch * Math.min(1, scale));

  const file = path.join(OUT, item.out);
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: cw, height: ch })
    .resize(tw, th, { fit: "fill" })
    .webp({ quality: 90, alphaQuality: 92, effort: 6 })
    .toFile(file);

  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`${item.out.padEnd(20)} ${tw}x${th}  ${kb} KB  (bbox ${cw}x${ch} from ${w}x${h})`);
}

for (const item of FILES) await run(item);
