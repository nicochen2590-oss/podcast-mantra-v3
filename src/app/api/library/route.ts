import { NextResponse } from "next/server";
import { sbReady, sbSelect } from "@/lib/supabase";

export const runtime = "nodejs";

type Row = {
  id: string; title: string; show: string | null; author: string | null;
  cover_url: string | null; audio_url: string | null; duration_sec: number | null;
  published_at: string | null; source_url: string | null; platform: string | null;
  theme: string | null;
};

/** 云端节目清单：部署后所有人读这一份 */
export async function GET() {
  if (!sbReady()) return NextResponse.json({ episodes: [], reason: "db-not-configured" });
  try {
    const rows = await sbSelect<Row>(
      "episodes?select=id,title,show,author,cover_url,audio_url,duration_sec,published_at,source_url,platform,theme&limit=2000"
    );
    const episodes = rows.map((r) => ({
      id: r.id,
      title: r.title,
      episode_no: null,
      cover_url: r.cover_url,
      show_cover_url: r.cover_url,
      show_id: null,
      audio_url: r.audio_url,
      source_url: r.source_url,
      platform: r.platform ?? "xiaoyuzhou",
      duration_sec: r.duration_sec,
      published_at: r.published_at,
      transcript_status: "ready",
      created_at: r.published_at ?? new Date().toISOString(),
      added_at: r.published_at ?? new Date().toISOString(),
      topic_id: null,
      theme: r.theme,
      author: r.author ?? r.show,
      summary: null,
      rating: null,
      note: null,
    }));
    return NextResponse.json({ episodes });
  } catch (e) {
    return NextResponse.json({ episodes: [], error: e instanceof Error ? e.message : "读取失败" });
  }
}
