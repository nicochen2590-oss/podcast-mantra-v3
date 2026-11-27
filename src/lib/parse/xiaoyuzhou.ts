export type ParsedEpisode = {
  platform: "xiaoyuzhou";
  platform_id: string;
  source_url: string;
  title: string;
  description: string | null;
  episode_no: string | null;
  cover_url: string | null;
  audio_url: string | null;
  duration_sec: number | null;
  published_at: string | null;
  show: {
    platform_id: string | null;
    title: string;
    author: string | null;
    cover_url: string | null;
    description: string | null;
  } | null;
};

/** 从用户输入里提取小宇宙单集 ID */
export function extractEpisodeId(input: string): string | null {
  const url = input.trim();
  const m = url.match(/xiaoyuzhoufm\.com\/episode\/([a-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

/** 判断链接是否属于小宇宙 */
export function isXiaoyuzhouUrl(input: string): boolean {
  return /xiaoyuzhoufm\.com/i.test(input);
}

/**
 * 抓取并解析小宇宙单集页。
 * 小宇宙是 Next.js 站点，元数据在 <script id="__NEXT_DATA__"> 里。
 */
export async function parseXiaoyuzhou(url: string): Promise<ParsedEpisode> {
  const eid = extractEpisodeId(url);
  if (!eid) throw new Error("这不是有效的小宇宙单集链接（应包含 /episode/单集ID）");

  const res = await fetch(`https://www.xiaoyuzhoufm.com/episode/${eid}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`抓取小宇宙页面失败（HTTP ${res.status}）`);

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("页面结构变化，未能读取元数据");

  const data = JSON.parse(match[1]);
  const ep = data?.props?.pageProps?.episode;
  if (!ep) throw new Error("未找到单集信息，可能是链接失效或需登录");

  const podcast = ep.podcast ?? null;
  const desc = typeof ep.description === "string" ? ep.description : ep.shownotes ?? null;

  return {
    platform: "xiaoyuzhou",
    platform_id: eid,
    source_url: `https://www.xiaoyuzhoufm.com/episode/${eid}`,
    title: ep.title || "未命名单集",
    description: desc ? String(desc).slice(0, 4000) : null,
    episode_no: null,
    cover_url: ep.image?.picUrl ?? ep.image?.thumbnailUrl ?? podcast?.image?.picUrl ?? null,
    audio_url: ep.enclosure?.url ?? null,
    duration_sec: typeof ep.duration === "number" ? Math.round(ep.duration) : null,
    published_at: ep.pubDate ?? null,
    show: podcast
      ? {
          platform_id: podcast.pid ?? null,
          title: podcast.title || "未知节目",
          author: podcast.author ?? null,
          cover_url: podcast.image?.picUrl ?? null,
          description: podcast.brief ?? null,
        }
      : null,
  };
}
