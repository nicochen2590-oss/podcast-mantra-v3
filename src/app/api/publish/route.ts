import { NextResponse } from "next/server";
import { sbUpsert } from "@/lib/supabase";

export const runtime = "nodejs";

/** 只给本机用：把整理好的结果写进库（带着密钥才能写） */
export async function POST(request: Request) {
  const key = request.headers.get("x-publish-key") ?? "";
  const expected = process.env.PM_PUBLISH_KEY ?? "";
  if (!expected || key !== expected) {
    return NextResponse.json({ error: "无权限" }, { status: 401 });
  }
  let body: { episode?: Record<string, unknown>; transcript?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const ep = body.episode;
  const tr = body.transcript;
  if (!ep?.id || !tr) return NextResponse.json({ error: "缺少 episode 或 transcript" }, { status: 400 });

  try {
    await sbUpsert("episodes", [ep], "id");
    await sbUpsert("transcripts", [{ ...tr, episode_id: ep.id, updated_at: new Date().toISOString() }], "episode_id");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "写入失败" }, { status: 500 });
  }
}
