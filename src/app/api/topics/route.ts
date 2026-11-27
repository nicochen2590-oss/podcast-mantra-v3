import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 新建一张专辑（= 一个主题）。不依赖唯一约束 / color 列，线上库结构旧时也能成功。
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: { name?: string; color?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const name = String(body.name ?? "").trim().slice(0, 20);
  if (!name) return NextResponse.json({ error: "请给专辑起个名字" }, { status: 400 });
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color! : "#7d6bab";

  // 先查重（只用一定存在的列）
  const { data: existing } = await supabase
    .from("topics").select("id, name").eq("name", name);
  if (existing?.length) {
    return NextResponse.json({ data: { id: existing[0].id, name: existing[0].name, color } });
  }

  // 先试带 color；线上 topics 没有 color 列时退回只写 name
  const { data, error } = await supabase
    .from("topics")
    .insert({ user_id: user.id, name, color })
    .select("id, name, color")
    .maybeSingle();

  if (!error) {
    return NextResponse.json({ data: data ?? { id: null, name, color } });
  }

  const retry = await supabase
    .from("topics")
    .insert({ user_id: user.id, name })
    .select("id, name")
    .maybeSingle();
  if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
  return NextResponse.json({ data: { ...(retry.data ?? {}), name, color } });
}
