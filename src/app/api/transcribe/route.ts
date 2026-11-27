import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/friendly-error";
import { asrWav, CHUNK_SEC, ensureAudio, ensureDaemon, languageOf, sliceWav } from "@/lib/asr";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 口头语清理：和 Python 那边保持一致，保证「未分析」的段落也是干净的 */
const FILLERS = /(嗯+|呃+|啊+|哦+|唉+|诶+|呀+|就是说|那个那个|这个这个|你知道吧|怎么说呢|对吧|然后呢|其实吧|就是吧|我跟你讲)/g;

function clean(t: string) {
  let s = (t || "").replace(FILLERS, "").replace(/\s+/g, "").replace(/([，。！？、；：])\1+/g, "$1").replace(/^[，。！？、；：\s]+/, "");
  if (s && !/[。！？!?…]$/.test(s)) s += "。";
  return s;
}
function gistOf(t: string) {
  const cut = t.search(/[。！？!?；;，,：:]/);
  const head = cut > 0 ? t.slice(0, cut) : t;
  return head.length > 16 ? `${head.slice(0, 16)}…` : head;
}

type Body = {
  audio_url?: string;
  title?: string;
  cursor_sec?: number;
  total_sec?: number;
};

/**
 * 推进一段自动转写（前端循环调用，一次一片，天然断点续传）。
 * 不需要登录、不写数据库：结果由浏览器自己收进 localStorage。
 */
export async function POST(request: Request) {
  let body: Body;
  try { body = (await request.json()) as Body; } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const audioUrl = String(body.audio_url ?? "").trim();
  if (!/^https?:\/\//i.test(audioUrl)) {
    return NextResponse.json({ status: "no_audio", message: "这一期没有可用的音频直链" });
  }

  const total = Math.max(0, Number(body.total_sec) || 0);
  const cursor = Math.max(0, Number(body.cursor_sec) || 0);

  // 1) 本地识别服务在不在
  const health = await ensureDaemon();
  if (!health) {
    return NextResponse.json({
      status: "need_env",
      message: "本机识别环境还没就绪（项目里缺 .venv 或 tools/asr_server.py）。",
    });
  }
  if (!health.ready) {
    return NextResponse.json({
      status: "loading",
      message: health.error
        ? `本地模型加载失败：${health.error.slice(0, 160)}`
        : "第一次使用，正在下载并加载本地识别模型（几百 MB，只需一次）…",
    });
  }

  // 2) 音频落到本地（同一地址只下一次）
  let audioFile: string;
  try {
    audioFile = await ensureAudio(audioUrl);
  } catch (e) {
    return NextResponse.json({ status: "error", message: friendlyError(e, "音频下载失败") });
  }

  // 3) 切一片出来
  const t0 = Date.now();
  const wav = await sliceWav(audioFile, cursor, CHUNK_SEC);
  const tSlice = Date.now();
  const nextCursor = cursor + CHUNK_SEC;

  if (!wav) {
    return NextResponse.json({
      status: "done",
      cursor_sec: total || cursor,
      total_sec: total,
      segments: [],
    });
  }

  // 4) 识别
  let raw;
  try {
    const lang = languageOf(String(body.title ?? ""), null);
    raw = await asrWav(wav, lang);
  } catch (e) {
    return NextResponse.json({ status: "error", message: friendlyError(e, "识别失败") });
  }

  const tAsr = Date.now();
  console.log(`[transcribe] cursor=${cursor} slice=${tSlice - t0}ms asr=${tAsr - tSlice}ms`);
  const segments = raw
    .map((s, i) => {
      const text = clean(s.text);
      if (text.length < 2) return null;
      return {
        seq: Math.floor(cursor / CHUNK_SEC) * 1000 + i + 1,
        start_ms: Math.round((cursor + s.start) * 1000),
        end_ms: Math.round((cursor + s.end) * 1000),
        speaker: null as string | null,
        text,
        text_en: null,
        gist: gistOf(text),
      };
    })
    .filter(Boolean);

  const done = total > 0 ? nextCursor >= total : segments.length === 0;

  return NextResponse.json({
    status: done ? "done" : "processing",
    cursor_sec: done ? (total || nextCursor) : nextCursor,
    total_sec: total,
    segments,
  });
}
