import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * 全局搜索：按关键词匹配 标题 / 概要 / 逐字稿 / 主题标签。
 * 每一路查询彼此独立：线上库缺 summary / text_en 等列时，
 * 只影响那一路，标题与标签搜索照样出结果。
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 访客没有云端数据可读：返回空结果，由前端的本地兜底接管，不报错
  if (!user) return NextResponse.json({ ids: [], matches: {} });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ ids: [], matches: {} });

  const like = `%${q}%`;

  const [byTitle, bySummary, byText, byTextEn, byTopic] = await Promise.all([
    supabase.from("episodes").select("id").ilike("title", like),
    supabase.from("episodes").select("id").ilike("summary", like),
    supabase.from("transcript_segments").select("episode_id").ilike("text", like),
    supabase.from("transcript_segments").select("episode_id").ilike("text_en", like),
    supabase.from("topics").select("id, name").ilike("name", like),
  ]);

  const ids = new Set<string>();
  const matches: Record<string, string[]> = {};
  const add = (id: string, source: string) => {
    ids.add(id);
    (matches[id] ??= []).push(source);
  };

  (byTitle.data ?? []).forEach((e) => add(e.id, "标题"));
  (bySummary.data ?? []).forEach((e) => add(e.id, "概要"));
  (byText.data ?? []).forEach((s) => add(s.episode_id, "逐字稿"));
  (byTextEn.data ?? []).forEach((s) => add(s.episode_id, "逐字稿"));
  if (byTopic.data?.length) {
    const topicIds = byTopic.data.map((t) => t.id);
    const { data: eps } = await supabase.from("episodes").select("id").in("topic_id", topicIds);
    (eps ?? []).forEach((e) => add(e.id, "专辑"));
  }

  return NextResponse.json({ ids: [...ids], matches });
}
