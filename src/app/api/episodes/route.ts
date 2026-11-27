import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Payload = {
  source_url: string;
  platform: string;
  platform_id: string | null;
  title: string;
  description: string | null;
  episode_no: string | null;
  cover_url: string | null;
  audio_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
  topic_id: string | null;
  show: {
    platform_id: string | null;
    title: string;
    author: string | null;
    cover_url: string | null;
    description: string | null;
  } | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let p: Payload;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!p.source_url || !p.title) {
    return NextResponse.json({ error: "缺少必要字段" }, { status: 400 });
  }

  // 1) 有节目信息则 upsert 到 shows（按 user_id + platform + platform_id 去重）
  let showId: string | null = null;
  if (p.show?.title) {
    const showRow = {
      user_id: user.id,
      platform: p.platform,
      platform_id: p.show.platform_id,
      title: p.show.title,
      author: p.show.author,
      cover_url: p.show.cover_url,
      description: p.show.description,
      homepage_url: null,
      feed_url: null,
    };
    const { data: existing } = await supabase
      .from("shows")
      .select("id")
      .eq("user_id", user.id)
      .eq("platform", p.platform)
      .eq("platform_id", p.show.platform_id ?? "")
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("shows").update(showRow).eq("id", existing.id);
      if (!error) showId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("shows")
        .insert(showRow)
        .select("id")
        .single();
      if (!error) showId = created?.id ?? null;
    }
    // 节目保存失败不阻断单集入库：单集本身才是核心
  }

  // 2) 插入 episode
  const episodeRow = {
    user_id: user.id,
    show_id: showId,
    topic_id: p.topic_id || null,
    platform: p.platform,
    platform_id: p.platform_id,
    source_url: p.source_url,
    title: p.title,
    episode_no: p.episode_no,
    cover_url: p.cover_url,
    audio_url: p.audio_url,
    duration_sec: p.duration_sec,
    published_at: p.published_at,
    transcript_status: "pending",
  };

  const { data: episode, error } = await supabase
    .from("episodes")
    .upsert(episodeRow, { onConflict: "user_id,platform,platform_id", ignoreDuplicates: false })
    .select("id, title")
    .single();

  if (error) {
    return NextResponse.json({ error: `保存内容失败：${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ data: episode });
}
