// 转写核心：ffmpeg 按时间从音频直链切片 → 硅基流动 SenseVoiceSmall（免费）转中文
// → 免费 LLM 整理（去口头语、补标点、修同音错字、切成带「一句话概括」的小段）
// → Hunyuan-MT-7B（免费）逐行翻译。全部免费模型，音频不入库，只临时落 /tmp。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeMindmap, parseLooseJson, type MindNode } from "./mindmap";

const execFileAsync = promisify(execFile);

const SF = "https://api.siliconflow.cn/v1";
const ASR_MODEL = "FunAudioLLM/SenseVoiceSmall";
const MT_MODEL = "tencent/Hunyuan-MT-7B";
const LLM_MODEL = "THUDM/GLM-4-9B-0414";

// 每片 60 秒：段内再按字数比例切到每句话，时间戳能精确到十来秒以内；
// 一次请求并行处理 3 片（约 3 分钟音频），远低于 Vercel 函数上限。
export const CHUNK_SEC = 60;
export const MAX_CHUNKS_PER_CALL = 3;
// 每片多切 6 秒：边界常常落在句子中间，靠重叠让下一片把这句听完整
const OVERLAP_SEC = 6;
export const LLM_FREE_NOTE = "GLM-4-9B-0414 + SenseVoiceSmall";

function key() {
  return process.env.SILICONFLOW_API_KEY?.trim() || "";
}
export function hasAsrKey() {
  return !!key();
}

function ffmpegPath(): string {
  // @ffmpeg-installer/ffmpeg 提供各平台静态二进制，Vercel(Linux) 与本机(Mac) 都能用
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@ffmpeg-installer/ffmpeg").path as string;
}

/** 从音频直链按 [start, start+dur) 切一段 16k 单声道 wav，返回临时文件路径 */
async function slice(audioUrl: string, start: number, dur: number): Promise<string | null> {
  const out = join(tmpdir(), `pm-${randomUUID()}.wav`);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "-ss", String(start),
    "-t", String(dur),
    "-i", audioUrl,
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    "-f", "wav", out,
  ];
  try {
    await execFileAsync(ffmpegPath(), args, { timeout: 90000, maxBuffer: 1024 * 1024 * 4 });
    return out;
  } catch {
    await unlink(out).catch(() => {});
    return null;
  }
}

async function chat(model: string, system: string, user: string, maxTokens = 900, temperature = 0.2) {
  const res = await fetch(`${SF}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 140)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() || "";
}

/** 调 SenseVoiceSmall：只返回整段文字，不给逐词时间戳 */
async function asr(file: string): Promise<string> {
  const buf = await readFile(file);
  const form = new FormData();
  form.append("model", ASR_MODEL);
  form.append("file", new Blob([buf], { type: "audio/wav" }), "chunk.wav");
  const res = await fetch(`${SF}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`ASR ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as { text?: string };
  return (json.text || "").trim();
}

// ── 整理：去口头语 / 补标点 / 修同音错字 / 切成带概括的小段 ──────────────────

const FILLERS = /(嗯+|呃+|啊+|哦+|唉|诶+|呀|就是说|那个那个|这个这个|你知道吧|怎么说呢|对吧)/g;

function localClean(raw: string): { gist: string; text: string }[] {
  const cleaned = raw
    .replace(FILLERS, "")
    .replace(/([，。！？、])\1+/g, "$1")
    .replace(/\s+/g, "")
    .replace(/^[，、。]+/, "")
    .trim();
  const sentences = cleaned.match(/[^。！？!?]+[。！？!?]?/g) || [cleaned];
  const out: { gist: string; text: string }[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const text = sentences.slice(i, i + 2).join("").trim();
    if (!text) continue;
    const gist = (text.split(/[，。！？!?；]/)[0] || text).slice(0, 16);
    out.push({ gist, text });
  }
  return out;
}

const POLISH_SYSTEM = `你是中文播客的逐字稿编辑。用户会给你节目信息和一段语音识别的原始文字，请整理成干净、准确的书面中文：
1. 删掉口头填充词与口吃重复（嗯、啊、呃、那个、就是说、然后呢、对吧、这个这个等），但不要删掉实际信息；
2. 补上正确的标点，修正同音错字；
3. 特别注意人名、公司名、产品名、机构名、数字与英文缩写：按读音找到对应的通行中文译名或官方写法再改正（例如 奈菲→奈飞、诺赫诺德→诺和诺德、里来→礼来、英伟达、豆包、12306、Scaling Laws）；拿不准的保持原样，不要臆造；
4. 不要改写观点、不要概括、不要合并成一两句，信息密度要与原文相当；
5. 按语义自然切成 2-4 段，每段 1-3 句，不能只剩一段。
只输出 JSON，不要解释、不要代码围栏：
{"segments":[{"gist":"这一段的概括，不超过16个字，名词短语，不要「这段讲了」这类前缀","text":"整理后的原文"}]}`;

async function polish(raw: string, context = ""): Promise<{ gist: string; text: string }[]> {
  try {
    const user = `${context ? `节目：${context}\n` : ""}原文：\n${raw}`;
    const out = await chat(LLM_MODEL, POLISH_SYSTEM, user, 1200, 0.2);
    const start = out.search(/[[{]/);
    const parsed = start >= 0
      ? (JSON.parse(out.slice(start, out.lastIndexOf("}") + 1)) as { segments?: { gist?: string; text?: string }[] })
      : null;
    const segs = (parsed?.segments ?? [])
      .map((s) => ({
        gist: String(s?.gist ?? "").replace(/^["「『\s]+|["」』\s]+$/g, "").slice(0, 24),
        text: String(s?.text ?? "").replace(/^["「\s]+|["」\s]+$/g, "").trim(),
      }))
      .filter((s) => s.text.length >= 4);
    if (segs.length === 0) return localClean(raw);
    // gist 缺失时用正文头一句补上
    return segs.map((s) => ({
      gist: s.gist || (s.text.split(/[，。！？!?；]/)[0] || s.text).slice(0, 16),
      text: s.text,
    }));
  } catch {
    return localClean(raw);
  }
}

/** 逐行翻译（行数对齐，便于与中文段一一对应）；失败不阻断转写 */
async function translateLines(lines: string[]): Promise<(string | null)[]> {
  if (!lines.length) return [];
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  try {
    const out = await chat(
      MT_MODEL,
      "把用户给的每一行中文分别翻译成自然流畅的英文。保持行数与编号完全对应，只输出「编号. 译文」，不要合并、不要遗漏、不要解释。",
      numbered,
      1600,
      0.2
    );
    const map = new Map<number, string>();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+)\s*[.、)]\s*(.+)$/);
      if (m) map.set(Number(m[1]), m[2].trim());
    }
    const aligned = lines.map((_, i) => map.get(i + 1) ?? null);
    return aligned.some(Boolean) ? aligned : lines.map(() => null);
  } catch {
    return lines.map(() => null);
  }
}

export type DraftSegment = { gist: string; text: string; text_en: string | null };
export type ChunkResult = { segments: DraftSegment[]; empty: boolean; durationSec: number };

/** 处理一片：切片 → 转写 → 整理分段 → 逐行翻译 */
export async function transcribeChunk(
  audioUrl: string, startSec: number, opts: { context?: string; isTail?: boolean } = {}
): Promise<ChunkResult> {
  const empty = { segments: [], empty: true, durationSec: 0 };
  const file = await slice(audioUrl, startSec, CHUNK_SEC + OVERLAP_SEC);
  if (!file) return empty; // 切片失败（多为已越过末尾）
  try {
    const buf = await readFile(file);
    // wav 头 44 字节；16k/16bit/mono → 每秒 32000 字节
    const actualSec = Math.max(0, (buf.length - 44) / 32000);
    if (actualSec < 1.5) return { ...empty, durationSec: actualSec };

    const raw = await asr(file);
    if (!raw) return { ...empty, durationSec: actualSec };

    let segs = await polish(raw, opts.context);
    if (!segs.length) return { ...empty, durationSec: actualSec };
    // 非最后一片：末尾那句多半被切断了，丢掉它——下一片重叠的 6 秒会把整句补回来
    if (!opts.isTail && segs.length > 1) {
      const last = segs[segs.length - 1].text.trim();
      if (!/[。！？!?…]$/.test(last)) segs = segs.slice(0, -1);
    }

    const en = await translateLines(segs.map((s) => s.text));
    return {
      segments: segs.map((s, i) => ({ ...s, text_en: en[i] ?? null })),
      empty: false,
      durationSec: actualSec,
    };
  } finally {
    await unlink(file).catch(() => {});
  }
}

/** 全部片段结束后，用免费 LLM 生成一期概要 */
export async function makeSummary(fullText: string): Promise<string | null> {
  if (!fullText || fullText.length < 40) return null;
  try {
    return await chat(
      LLM_MODEL,
      "你是播客编辑。根据逐字稿写一段 120-180 字的中文概要，说清这期讲了什么、有哪些关键话题，语言平实有温度，不要分点、不要小标题、不要出现「本期节目」这类套话。",
      fullText.slice(0, 6000),
      400,
      0.5
    ) || null;
  } catch {
    return null;
  }
}

/** 生成思维导图 JSON 树（3 层：主题 → 分支 → 要点） */
export async function makeMindmap(gists: string, title: string): Promise<MindNode | null> {
  if (!gists || gists.length < 30) return null;
  try {
    const out = await chat(
      LLM_MODEL,
      `你在为一期播客画「观点骨架图」，不是给逐字稿做目录。输入是带 [分:秒] 的分段要点。
只输出 JSON，不要解释、不要代码围栏：
{"name":"整期主线（≤14字）","t":0,"children":[{"name":"一级议题（≤12字）","t":秒,"children":[{"name":"二级论点（≤18字）","t":秒,"children":[{"name":"三级论据（≤22字）","t":秒}]}]}]}

硬性要求：
1. 三到四层：一级 3-5 个；二级每个 2-4 个；只要材料里有具体支撑，二级下必须再落一层三级。
2. 每一层都必须是你概括后的话：判断句或名词短语，像论文小标题。
   严禁直接抄逐字稿原句；严禁用「他说」「然后」「我觉得」「关于…」「这一部分」这类口语开头。
3. 一级是议题，二级是有立场的观点，三级是具体支撑：方法、数字、反例、人物、场景。
4. 同一父节点下的子节点必须互斥、有区分度；禁止「观点」「内容」「其他」「总结」这类空标签。
5. 每个节点都给 t（整数秒），取材料里最接近的 [分:秒]；拿不准就填父节点的 t。`,
      `节目名：《${title}》\n带时间戳的分段要点：\n${gists.slice(0, 5000)}`,
      1800,
      0.35
    );
    return normalizeMindmap(parseLooseJson(out), title);
  } catch {
    return null;
  }
}
