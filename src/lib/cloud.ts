/**
 * 浏览器直连 Supabase 的只读访问。
 * 部署到纯静态托管（EdgeOne Pages / OSS）时，没有服务端接口可用，
 * 页面自己用公开的 publishable key 读数据即可（两张表只开放了 select）。
 */
// 兜底默认值：这两个是「公开只读」凭证，本来就会打进前端 JS，
// 写在这里是为了避免托管平台构建时没注入环境变量导致读不到数据。
const URL_BASE =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://aoaujvcrtvnauxdrtuuz.supabase.co";
const KEY =
  process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_Td_y7jeM4TgF7DqmXHK1Mg_96I4eo27";

export function cloudReady(): boolean {
  return Boolean(URL_BASE && KEY);
}

async function sbGet<T>(path: string): Promise<T[]> {
  if (!cloudReady()) return [];
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

export type CloudEpisode = {
  id: string; title: string; show: string | null; author: string | null;
  cover_url: string | null; audio_url: string | null; duration_sec: number | null;
  published_at: string | null; source_url: string | null; platform: string | null;
  theme: string | null; summary: string | null;
};

export async function cloudLibrary(): Promise<CloudEpisode[]> {
  return sbGet<CloudEpisode>(
    "episodes?select=id,title,show,author,cover_url,audio_url,duration_sec,published_at,source_url,platform,theme,summary&limit=2000"
  );
}

export async function cloudTranscript(id: string): Promise<{ episode: CloudEpisode | null; transcript: Record<string, unknown> | null }> {
  const [eps, rows] = await Promise.all([
    sbGet<CloudEpisode>(`episodes?select=*&id=eq.${encodeURIComponent(id)}&limit=1`),
    sbGet<Record<string, unknown>>(`transcripts?select=*&episode_id=eq.${encodeURIComponent(id)}&limit=1`),
  ]);
  return { episode: eps[0] ?? null, transcript: rows[0] ?? null };
}


/** 云端哪些期已经有逐字稿（用来在列表里标记"已成文"） */
export async function cloudTranscriptIds(): Promise<string[]> {
  const rows = await sbGet<{ episode_id: string }>("transcripts?select=episode_id&limit=2000");
  return rows.map((r) => r.episode_id);
}
