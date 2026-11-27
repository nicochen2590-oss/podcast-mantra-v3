import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sbReady, sbSelect } from "@/lib/supabase";

/** 本机批量转写脚本写下的文件（data/transcripts/<id>.json） */
async function localFile(id: string) {
  try {
    const safe = id.replace(/[^\w.-]/g, "_");
    const raw = await readFile(path.join(process.cwd(), "data", "transcripts", `${safe}.json`), "utf8");
    return JSON.parse(raw) as { episode?: Record<string, unknown>; transcript?: Record<string, unknown> };
  } catch {
    return null;
  }
}

export const runtime = "nodejs";

/** 访客读成品：全站共享的一份 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // 先看本机文件（批量脚本的产物），再看云端
  const local = await localFile(id);
  if (local?.transcript) {
    return NextResponse.json({ found: true, episode: local.episode ?? null, transcript: local.transcript, source: "local" });
  }
  if (!sbReady()) return NextResponse.json({ found: false, reason: "db-not-configured" });
  try {
    const [eps, rows] = await Promise.all([
      sbSelect<Record<string, unknown>>(`episodes?select=*&id=eq.${encodeURIComponent(id)}&limit=1`),
      sbSelect<Record<string, unknown>>(`transcripts?select=*&episode_id=eq.${encodeURIComponent(id)}&limit=1`),
    ]);
    if (!rows.length) return NextResponse.json({ found: false, episode: eps[0] ?? null });
    return NextResponse.json({ found: true, episode: eps[0] ?? null, transcript: rows[0] });
  } catch (e) {
    return NextResponse.json({ found: false, error: e instanceof Error ? e.message : "读取失败" });
  }
}
