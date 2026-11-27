import { NextResponse } from "next/server";
import { readJob, startJob } from "@/lib/analyze-jobs";

export const runtime = "nodejs";

/** 启动后台分析：立刻返回，不阻塞 */
export async function POST(request: Request) {
  let body: { episode_id?: string; title?: string; segments?: { start_ms: number; text: string }[]; episode?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const id = String(body.episode_id ?? "").trim();
  const segments = body.segments ?? [];
  if (!id || !segments.length) return NextResponse.json({ error: "缺少 episode_id 或逐字稿" }, { status: 400 });
  const job = await startJob(id, body.title ?? "", segments, (body as { episode?: Record<string, unknown> }).episode);
  return NextResponse.json({ ok: true, status: job.status, started_at: job.started_at });
}

/** 查询状态；完成时带上结果 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("episode_id") ?? "";
  if (!id) return NextResponse.json({ error: "缺少 episode_id" }, { status: 400 });
  const job = await readJob(id);
  if (!job) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    status: job.status,
    error: job.error ?? null,
    result: job.status === "done" ? job.result : null,
    elapsed: Math.round(((job.finished_at ?? Date.now()) - job.started_at) / 1000),
  });
}
