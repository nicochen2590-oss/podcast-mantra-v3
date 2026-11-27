import { NextResponse } from "next/server";
import { analyze, daemonHealth } from "@/lib/asr";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = { title?: string; segments?: { start_ms?: number; text?: string }[] };

/**
 * 收尾整理：把整份逐字稿交给本机规则分析器，产出
 * 一句话概括、术语关键词、高光片段、以及一二三级导图。
 * 纯本地规则，不联网、不花钱。
 */
export async function POST(request: Request) {
  let body: Body;
  try { body = (await request.json()) as Body; } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const segments = (body.segments ?? [])
    .map((s) => ({ start_ms: Number(s.start_ms) || 0, text: String(s.text ?? "") }))
    .filter((s) => s.text.length >= 2);

  if (segments.length < 3) {
    return NextResponse.json({ status: "too_short", message: "逐字稿太短，先多转一点再整理。" });
  }

  const health = await daemonHealth();
  if (!health?.ready) {
    return NextResponse.json({ status: "need_env", message: "本地识别服务没在跑。" });
  }

  const result = await analyze(String(body.title ?? ""), segments);
  if (!result) return NextResponse.json({ status: "error", message: "整理失败" }, { status: 500 });

  return NextResponse.json({ status: "ok", ...result });
}
