/**
 * Supabase 服务端访问（只用 REST，不引 SDK）。
 * 密钥只在这里读，永远不会出现在前端代码里。
 */
const URL_BASE = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

export function sbReady(): boolean {
  return Boolean(URL_BASE && KEY);
}

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

export async function sbSelect<T>(path: string): Promise<T[]> {
  const res = await sb(path);
  return (await res.json()) as T[];
}

export async function sbUpsert(table: string, rows: unknown, onConflict?: string): Promise<void> {
  const query = onConflict ? `${table}?on_conflict=${onConflict}` : table;
  await sb(query, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}
