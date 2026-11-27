import { NextResponse } from "next/server";
import { isXiaoyuzhouUrl, parseXiaoyuzhou } from "@/lib/parse/xiaoyuzhou";
import { isApplePodcastUrl, parseApple } from "@/lib/parse/apple";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // 链接解析是纯读取，不写库、不碰用户数据：访客也能用，
  // 保存动作由前端决定落到本机还是云端。
  let url = "";
  try {
    const body = await request.json();
    url = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "请提供链接" }, { status: 400 });

  if (isApplePodcastUrl(url)) {
    try {
      return NextResponse.json({ data: await parseApple(url) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "解析失败";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  }

  if (!isXiaoyuzhouUrl(url)) {
    return NextResponse.json(
      { error: "目前支持小宇宙链接（xiaoyuzhoufm.com/episode/...），其他平台正在接入中", code: "UNSUPPORTED" },
      { status: 400 }
    );
  }

  try {
    const parsed = await parseXiaoyuzhou(url);
    return NextResponse.json({ data: parsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析失败";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
