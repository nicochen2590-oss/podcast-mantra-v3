/**
 * 把「用户自己粘进来的文字」变成带时间戳的逐字稿段落。
 *
 * 为什么在前端做：去掉登录之后没有转写后端，但一期内容仍然需要逐字稿
 * 和思维导图才「翻得开」。这里用最朴素的办法——
 *   1. 认出文字里本来就有的时间码（[12:34] / 00:12:34 / (12:34)），有就以它为准；
 *   2. 没有时间码的地方，按中文口播语速（约每秒 4.2 字）在锚点之间按字数分配；
 *   3. 整段都没有时间码时，有音频总长就整体缩放到接近真实时长。
 * 时间戳是「估算」的，界面上会如实说明，不假装是转写引擎给的。
 */
import type { TranscriptSegment } from "@/app/dashboard/types";

/** 中文口播的粗略语速：每秒字数 */
const CHARS_PER_SEC = 4.2;
const MIN_CHARS = 42;
const MAX_CHARS = 150;
const MIN_SEG_MS = 1200;

/** 行首时间码：`[12:34]` `00:12:34` `(12:34)` `12:34 -` 等 */
const TIME_HEAD = /^[[(（]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[\])）]?\s*(?:[-–—~→>]\s*)?/;

/** 统一处理 mm:ss 与 hh:mm:ss 两种写法 */
function readTime(a: string, b: string, c?: string): number | null {
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  if (c === undefined) return (x * 60 + y) * 1000;
  const z = Number(c);
  if (Number.isNaN(z)) return null;
  return (x * 3600 + y * 60 + z) * 1000;
}

/** 行首「阿May：」这类说话人标签；编号（1：/ EP2：）不算 */
function stripSpeaker(line: string): { text: string; speaker: string | null } {
  const m = line.match(/^([^\s：:，。,\d]{1,6})[：:]\s*/);
  if (!m) return { text: line, speaker: null };
  if (/^[\dEPep#]+$/.test(m[1])) return { text: line, speaker: null };
  return { text: line.slice(m[0].length), speaker: m[1] };
}

function splitSentences(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of s) {
    buf += ch;
    if (/[。！？!?；;…]/.test(ch)) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** 把一段长文字切成 42~150 字的段落；末尾过短的一段并回上一段 */
function packSentences(sentences: string[]): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > MAX_CHARS) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < s.length; i += MAX_CHARS) chunks.push(s.slice(i, i + MAX_CHARS));
      continue;
    }
    if (cur && cur.length + s.length > MAX_CHARS) {
      chunks.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur) {
    if (chunks.length && cur.length < MIN_CHARS) chunks[chunks.length - 1] += cur;
    else chunks.push(cur);
  }
  return chunks;
}

/** 一句概括：取第一个小句，超过 26 字再截断 */
export function firstClause(text: string): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cut = t.search(/[。！？!?；;，,：:]/);
  const head = cut > 0 ? t.slice(0, cut) : t;
  return head.length > 26 ? `${head.slice(0, 26)}…` : head;
}

/** 粗略估算一段文字讲完要多久（提示「预计时长」用） */
export function estimateSeconds(text: string): number {
  return Math.max(1, Math.round((text || "").length / CHARS_PER_SEC));
}

export function transcriptTextToSegments(
  raw: string,
  durationSec?: number | null
): TranscriptSegment[] {
  const text = (raw || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  // ---------- 1. 逐行拆段落，认出每段自带的时间码与说话人 ----------
  type Chunk = { text: string; atMs?: number; speaker: string | null };
  const chunks: Chunk[] = [];

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let atMs: number | undefined;
    let rest = line;
    const tm = line.match(TIME_HEAD);
    if (tm) {
      const ms = tm[3] !== undefined ? readTime(tm[1], tm[2], tm[3]) : readTime(tm[1], tm[2]);
      if (ms !== null && ms >= 0) {
        atMs = ms;
        rest = line.slice(tm[0].length).trim();
      }
    }
    if (!rest) continue;

    const { text: body, speaker } = stripSpeaker(rest);
    const parts = packSentences(splitSentences(body || rest));
    parts.forEach((p, i) => chunks.push({ text: p, atMs: i === 0 ? atMs : undefined, speaker }));
  }
  if (!chunks.length) return [];

  // ---------- 2. 铺时间线 ----------
  const charMs = (s: string) => Math.max(MIN_SEG_MS, Math.round((s.length / CHARS_PER_SEC) * 1000));
  const starts: number[] = new Array(chunks.length).fill(0);
  const anchors = chunks
    .map((c, i) => (c.atMs === undefined ? -1 : i))
    .filter((i) => i >= 0);

  if (!anchors.length) {
    // 全篇没有时间码：从 0 顺推
    let cursor = 0;
    chunks.forEach((c, i) => {
      starts[i] = cursor;
      cursor += charMs(c.text);
    });
  } else {

    // 第一个锚点之前：从锚点往回倒推，但不早于 0
    const first = anchors[0];
    let cursor = chunks[first].atMs!;
    for (let i = first - 1; i >= 0; i--) {
      cursor = Math.max(0, cursor - charMs(chunks[i].text));
      starts[i] = cursor;
    }

    // 锚点之间：按字数把区间分掉
    for (let k = 0; k < anchors.length; k++) {
      const a = anchors[k];
      const b = anchors[k + 1];
      starts[a] = chunks[a].atMs!;
      if (b === undefined) break;
      const span = Math.max(0, (chunks[b].atMs ?? 0) - (chunks[a].atMs ?? 0));
      const weights: number[] = [];
      for (let i = a; i < b; i++) weights.push(chunks[i].text.length);
      const total = weights.reduce((x, y) => x + y, 0) || 1;
      let acc = 0;
      for (let i = a; i < b; i++) {
        starts[i] = (chunks[a].atMs ?? 0) + Math.round((acc / total) * span);
        acc += weights[i - a];
      }
    }

    // 最后一个锚点之后：继续顺推
    const last = anchors[anchors.length - 1];
    let tail = starts[last] + charMs(chunks[last].text);
    for (let i = last + 1; i < chunks.length; i++) {
      starts[i] = tail;
      tail += charMs(chunks[i].text);
    }
  }

  // ---------- 3. 单调化（锚点写错时也不让时间线倒流） ----------
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1];
  }

  // ---------- 4. 整段没有时间码且有音频总长：整体缩放到接近真实时长 ----------
  if (!anchors.length && durationSec && durationSec > 0) {
    const lastDur = charMs(chunks[chunks.length - 1].text);
    const spanMs = starts[starts.length - 1] + lastDur;
    const target = durationSec * 1000;
    if (spanMs > 0 && target > spanMs * 0.6) {
      const k = target / spanMs;
      for (let i = 0; i < starts.length; i++) starts[i] = Math.round(starts[i] * k);
    }
  }

  // ---------- 5. 成型 ----------
  const segments: TranscriptSegment[] = chunks.map((c, i) => {
    const start = starts[i];
    const next = starts[i + 1];
    const end = next !== undefined && next > start ? next : start + charMs(c.text);
    return {
      seq: i + 1,
      start_ms: start,
      end_ms: end,
      speaker: c.speaker,
      text: c.text,
      text_en: null,
      gist: firstClause(c.text),
    };
  });

  return segments;
}
