import { NextResponse } from "next/server";
import { sbReady, sbSelect, sbUpsert } from "@/lib/supabase";

export const runtime = "nodejs";

/** 访客申请转写：同一期只留一条，重复申请只增加 count */
export async function POST(request: Request) {
  let body: { episode_id?: string; title?: string; source_url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
  const id = String(body.episode_id ?? "").trim();
  if (!id) return NextResponse.json({ error: "缺少 episode_id" }, { status: 400 });
  if (!sbReady()) return NextResponse.json({ ok: true, stored: false });

  try {
    // 先把这一期登记进 episodes（可能只是访客刚加进来的），再写申请，避免外键报错
    await sbUpsert("episodes", [{
      id,
      title: body.title ?? id,
      source_url: body.source_url ?? null,
      platform: "unknown",
    }], "id");

    const exist = await sbSelect<{ count: number }>(`transcribe_requests?select=count&episode_id=eq.${encodeURIComponent(id)}&limit=1`);
    const count = (exist[0]?.count ?? 0) + 1;
    await sbUpsert("transcribe_requests", [{
      episode_id: id,
      title: body.title ?? null,
      source_url: body.source_url ?? null,
      count,
      status: "pending",
      updated_at: new Date().toISOString(),
    }], "episode_id");
    return NextResponse.json({ ok: true, stored: true, count });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "写入失败" }, { status: 500 });
  }
}
