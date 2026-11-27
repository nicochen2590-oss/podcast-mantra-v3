import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: { rating?: number | null; note?: string | null; topic_id?: string | null };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const desired: Record<string, unknown> = {};
  if ("rating" in body) desired.rating = body.rating;
  if ("note" in body) desired.note = body.note;
  if ("topic_id" in body && body.topic_id && body.topic_id !== "__fallback__") desired.topic_id = body.topic_id;

  const saved: string[] = [];
  const skipped: string[] = [];

  // 先整体更新（云端字段齐全时一次成功）
  const whole = await supabase.from("episodes").update(desired).eq("id", id).eq("user_id", user.id);
  if (!whole.error) {
    saved.push(...Object.keys(desired));
  } else {
    // 线上库可能还没加 rating/note 等列：逐字段重试，能存的先存，
    // 存不下的交给前端 localStorage 兜底，不再整单失败。
    for (const [k, v] of Object.entries(desired)) {
      const one = await supabase.from("episodes").update({ [k]: v }).eq("id", id).eq("user_id", user.id);
      if (one.error) skipped.push(k); else saved.push(k);
    }
  }

  // 只用一定存在的 id 列确认归属
  const { data: own } = await supabase
    .from("episodes").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!own) return NextResponse.json({ error: "没有权限修改这条内容" }, { status: 403 });

  const savedData: Record<string, unknown> = { id };
  saved.forEach((k) => { savedData[k] = desired[k]; });
  return NextResponse.json({ data: savedData, saved, skipped });
}
