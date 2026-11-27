/**
 * Apple Podcasts 单集：用公开的 iTunes Lookup 接口取元数据。
 * 链接形如 https://podcasts.apple.com/cn/podcast/xxx/id1234567890?i=1000654321
 * 其中 i= 是单集的 trackId。
 */
type LookupItem = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  description?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  episodeUrl?: string;
  previewUrl?: string;
  feedUrl?: string;
  collectionId?: number;
};

export function isApplePodcastUrl(url: string): boolean {
  return /podcasts\.apple\.com\/.+\/id\d+/i.test(url);
}

export function parseAppleIds(url: string): { collectionId?: string; episodeId?: string } {
  const collectionId = url.match(/\/id(\d+)/)?.[1];
  const episodeId = url.match(/[?&]i=(\d+)/)?.[1];
  return { collectionId, episodeId };
}

export async function parseApple(url: string) {
  const { collectionId, episodeId } = parseAppleIds(url);
  if (!collectionId) throw new Error("这不像 Apple Podcasts 的单集链接（缺少 id）");

  const base = "https://itunes.apple.com/lookup";
  const withEp = episodeId
    ? `${base}?id=${collectionId}&entity=podcastEpisode&limit=200`
    : `${base}?id=${collectionId}`;
  const res = await fetch(withEp, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Apple 接口返回 ${res.status}`);
  const json = (await res.json()) as { results?: LookupItem[] };
  const items = json.results ?? [];
  const show = items.find((x) => x.wrapperType === "track" || x.kind === "podcast");
  const eps = items.filter((x) => x.kind === "podcast-episode");

  let ep: LookupItem | undefined;
  if (episodeId) ep = eps.find((x) => String(x.trackId) === episodeId);
  if (!ep && episodeId) {
    // limit 抓不全时，直接按单集 id 再查一次
    const r2 = await fetch(`${base}?id=${episodeId}&entity=podcastEpisode`, { signal: AbortSignal.timeout(15000) });
    if (r2.ok) {
      const j2 = (await r2.json()) as { results?: LookupItem[] };
      ep = j2.results?.find((x) => String(x.trackId) === episodeId);
    }
  }
  if (!ep) throw new Error("没找到这一集，可能需要用带 ?i= 的单集链接");

  return {
    title: ep.trackName ?? "未知单集",
    show: ep.collectionName ?? show?.collectionName ?? "",
    author: ep.artistName ?? show?.artistName ?? "",
    summary: ep.description ?? "",
    cover_url: ep.artworkUrl600 ?? ep.artworkUrl100 ?? null,
    show_cover_url: show?.artworkUrl600 ?? ep.artworkUrl600 ?? null,
    audio_url: ep.episodeUrl ?? ep.previewUrl ?? null,
    duration_sec: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : null,
    published_at: ep.releaseDate ? ep.releaseDate.slice(0, 10) : null,
    platform: "apple" as const,
    source_url: url,
  };
}
