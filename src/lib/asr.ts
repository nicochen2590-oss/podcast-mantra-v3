/**
 * 本地转写（零成本）：音频下载 → ffmpeg 切片 → 本机 whisper 识别 → 规则化整理。
 *
 * 为什么这么绕：小宇宙的音频在 CDN 上，ffmpeg 4.4 直连会 TLS 握手失败，
 * 所以先用 Node 把音频落到 /tmp 缓存，再让 ffmpeg 读本地文件切片。
 * whisper 跑在一个常驻的 Python 小服务里（tools/asr_server.py），
 * 模型只加载一次；这里只负责喂音频、拿结果。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

const DAEMON = process.env.PM_ASR_URL ?? "http://127.0.0.1:8765";
const CACHE_DIR = join(tmpdir(), "pm-audio");
const CHUNK_SEC = Number(process.env.PM_ASR_CHUNK_SEC ?? 60);

export { CHUNK_SEC };

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@ffmpeg-installer/ffmpeg").path as string;
}

function venvPython(): string | null {
  // 虚拟环境放在项目外（Turbopack 遇到项目里的符号链接会构建失败）
  return process.env.PM_PYTHON ?? join(homedir(), "mantra-venv", "bin", "python");
}

async function exists(p: string) {
  try { await stat(p); return true; } catch { return false; }
}

// ───────────────────────── 音频缓存 ─────────────────────────

const downloading = new Map<string, Promise<string>>();

/** 把音频下到本地缓存（同一地址并发只下一次），返回本地路径 */
export async function ensureAudio(url: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 20);
  const ext = (url.match(/\.(mp3|m4a|aac|wav|ogg|opus)(\?|$)/i)?.[1] ?? "m4a").toLowerCase();
  const file = join(CACHE_DIR, `${hash}.${ext}`);

  if (await exists(file)) {
    const st = await stat(file);
    if (st.size > 1024) return file;
  }

  const running = downloading.get(file);
  if (running) return running;

  const task = (async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Referer: "https://www.xiaoyuzhoufm.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`音频下载失败（HTTP ${res.status}）`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4096) throw new Error("音频文件异常（太小）");
    await writeFile(file, buf);
    return file;
  })().finally(() => downloading.delete(file));

  downloading.set(file, task);
  return task;
}

// ───────────────────────── 切片 ─────────────────────────

/** 从本地音频切出 [start, start+dur) 的 16k 单声道 wav；越界返回 null */
/**
 * 一次性把整段音频切成 16k 单声道 wav，之后每片都是"取现成的"。
 * 之前每片都单独跑一次 ffmpeg，一个 60 秒分片要多花十几秒，
 * 一小时的节目就是十几分钟的纯等待。
 */
const preparing = new Map<string, Promise<boolean>>();

async function ensureChunks(audioFile: string): Promise<boolean> {
  const dir = join(CACHE_DIR, `split-${createHash("sha1").update(audioFile).digest("hex").slice(0, 12)}`);
  const done = join(dir, ".done");
  if (await exists(done)) return true;
  if (preparing.has(audioFile)) return preparing.get(audioFile)!;

  const task = (async () => {
    await mkdir(dir, { recursive: true });
    await execFileAsync(
      ffmpegPath(),
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", audioFile,
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        "-f", "segment", "-segment_time", String(CHUNK_SEC), "-reset_timestamps", "1",
        join(dir, "part-%04d.wav"),
      ],
      { timeout: 900000, maxBuffer: 8 * 1024 * 1024 }
    );
    await writeFile(done, "1");
    return true;
  })().catch(() => false).finally(() => preparing.delete(audioFile));

  preparing.set(audioFile, task);
  return task;
}

/** 从本地音频切出 [start, start+dur) 的 16k 单声道 wav；越界返回 null */
export async function sliceWav(audioFile: string, start: number, dur: number): Promise<string | null> {
  // 先尝试"整段预切"，命中就直接取文件（毫秒级）
  if (dur === CHUNK_SEC && (await ensureChunks(audioFile))) {
    const dir = join(CACHE_DIR, `split-${createHash("sha1").update(audioFile).digest("hex").slice(0, 12)}`);
    const idx = Math.round(start / CHUNK_SEC);
    const path = join(dir, `part-${String(idx).padStart(4, "0")}.wav`);
    if (await exists(path)) {
      const st = await stat(path);
      return st.size < 32000 * 1.2 ? null : path;
    }
    return null;
  }

  const out = join(CACHE_DIR, `chunk-${createHash("sha1").update(`${audioFile}:${start}`).digest("hex").slice(0, 16)}.wav`);
  try {
    await execFileAsync(
      ffmpegPath(),
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", String(start), "-t", String(dur),
        "-i", audioFile,
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        "-f", "wav", out,
      ],
      { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }
    );
    const st = await stat(out);
    if (st.size < 32000 * 1.2) return null;
    return out;
  } catch {
    return null;
  }
}

// ───────────────────────── 本地 ASR 服务 ─────────────────────────

export type DaemonHealth = { ok: boolean; ready: boolean; model?: string; error?: string };

export async function daemonHealth(): Promise<DaemonHealth | null> {
  try {
    const res = await fetch(`${DAEMON}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return (await res.json()) as DaemonHealth;
  } catch {
    return null;
  }
}

let spawning = false;
/** 确保本地 ASR 服务在跑；返回它当前是否已经可以推理 */
export async function ensureDaemon(): Promise<DaemonHealth | null> {
  const health = await daemonHealth();
  if (health) return health;

  const py = venvPython();
  if (!py || !(await exists(py))) return null;

  if (!spawning) {
    spawning = true;
    try {
      const child = spawn(/*turbopackIgnore: true*/ py, [/*turbopackIgnore: true*/ join(process.cwd(), "tools", "asr_server.py")], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
    } finally {
      spawning = false;
    }
  }

  // 等它把端口开起来（模型在后台加载，ready 可能是 false）
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const h = await daemonHealth();
    if (h) return h;
  }
  return null;
}

export type RawSeg = { start: number; end: number; text: string };

/** 纯英文节目强制 zh 会识别成乱码甚至卡死，这里按标题/作者判断语言 */
/**
 * 语言策略：默认交给识别模型自己判断。
 * 标题只能提示语言倾向，标题是中文、内容是英文的节目很常见（访谈/双语节目），
 * 按标题强行指定会得到"中英混杂 + 复读"的乱码，所以默认 auto。
 */
export function languageOf(_title: string, _author?: string | null): "zh" | "en" | "auto" {
  return "auto";
}

export async function asrWav(wav: string, language: "zh" | "en" | "auto" = "zh"): Promise<RawSeg[]> {
  const res = await fetch(`${DAEMON}/asr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wav, language }),
    signal: AbortSignal.timeout(150000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`本地识别失败：${t.slice(0, 120)}`);
  }
  const json = (await res.json()) as { segments?: RawSeg[] };
  return json.segments ?? [];
}

export type Analyzed = {
  items: { start_ms: number; text: string; gist: string }[];
  summary: string;
  keywords: { term: string; brief: string }[];
  highlights: { start_ms: number; text: string }[];
  mindmap: unknown;
};

export async function analyze(title: string, segments: { start_ms: number; text: string }[]): Promise<Analyzed | null> {
  try {
    const res = await fetch(`${DAEMON}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, segments }),
      signal: AbortSignal.timeout(1800000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Analyzed;
  } catch {
    return null;
  }
}
