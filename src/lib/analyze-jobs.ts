/**
 * 服务端后台分析任务：请求只负责"启动"，任务在服务器上继续跑，
 * 前端轮询状态。这样长稿（1–3 小时）不会因为浏览器断开而白跑。
 */
import http from "node:http";

/**
 * 用 node:http 直接调识别服务。
 * 不用 fetch：Node 的 fetch 底层（undici）默认 5 分钟没收到响应头就会掐断，
 * 而 90–120 分钟的节目分析要 10–20 分钟，正好被它干掉（报 fetch failed / UND_ERR_HEADERS_TIMEOUT）。
 */
function postJson(url: string, body: unknown, timeoutMs = 45 * 60 * 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": payload.length },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(new Error(`识别服务返回了无法解析的内容（HTTP ${res.statusCode}）`));
          }
        });
      }
    );
    req.on("timeout", () => { req.destroy(new Error("识别服务响应超时")); });
    req.on("error", (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "analyze");
const DAEMON = process.env.PM_ASR_URL ?? "http://127.0.0.1:8765";

export type JobStatus = "running" | "done" | "error";

export type Job = {
  episode_id: string;
  status: JobStatus;
  started_at: number;
  finished_at?: number;
  error?: string;
  result?: unknown;
};

const running = new Map<string, Job>();

const fileOf = (id: string) => path.join(DIR, `${id.replace(/[^\w.-]/g, "_")}.json`);

export async function readJob(id: string): Promise<Job | null> {
  const mem = running.get(id);
  if (mem) return mem;
  try {
    const job = JSON.parse(await readFile(fileOf(id), "utf8")) as Job;
    // 服务中途重启会让内存里的任务丢失；超过 50 分钟还挂着就判失败，避免前端一直等
    if (job.status === "running" && Date.now() - job.started_at > 50 * 60 * 1000) {
      job.status = "error";
      job.error = "任务被中断（服务重启或超时），请重新整理";
      job.finished_at = Date.now();
    }
    return job;
  } catch {
    return null;
  }
}

export async function startJob(episodeId: string, title: string, segments: { start_ms: number; text: string }[], episodeMeta?: Record<string, unknown>): Promise<Job> {
  const existing = await readJob(episodeId);
  if (existing?.status === "running" && Date.now() - existing.started_at < 40 * 60 * 1000) {
    return existing; // 已经在跑，直接复用
  }
  const job: Job = { episode_id: episodeId, status: "running", started_at: Date.now() };
  running.set(episodeId, job);
  await mkdir(DIR, { recursive: true });
  try { await writeFile(fileOf(episodeId), JSON.stringify(job), "utf8"); } catch { /* 忽略 */ }

  void (async () => {
    let lastErr = "";
    try {
      // 识别服务偶尔会在长任务上断连（fetch failed），重试两次基本都能过
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const json = (await postJson(`${DAEMON}/analyze`, { title, segments })) as { error?: string };
          if (json?.error) throw new Error(String(json.error));
          job.status = "done";
          job.result = json;
          lastErr = "";
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "分析失败";
          console.error(`[analyze-job] ${episodeId} 第 ${attempt} 次失败：${lastErr}`);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (lastErr) {
        job.status = "error";
        job.error = lastErr;
      }
    } finally {
      job.finished_at = Date.now();
      running.set(episodeId, job);

      // 分析成功就自动同步到 Supabase：这样部署上线后别人也能看到
      if (job.status === "done") {
        try {
          const { sbUpsert } = await import("@/lib/supabase");
          const r = job.result as Record<string, unknown>;
          await sbUpsert("episodes", [{
            id: episodeId,
            title: episodeMeta?.title ?? title,
            show: episodeMeta?.show ?? null,
            author: episodeMeta?.author ?? null,
            cover_url: episodeMeta?.cover_url ?? null,
            audio_url: episodeMeta?.audio_url ?? null,
            duration_sec: episodeMeta?.duration_sec ?? null,
            published_at: episodeMeta?.published_at ?? null,
            source_url: episodeMeta?.source_url ?? null,
            platform: episodeMeta?.platform ?? "unknown",
            theme: episodeMeta?.theme ?? null,
            subtopic: episodeMeta?.subtopic ?? null,
            content_type: episodeMeta?.content_type ?? null,
            audience: episodeMeta?.audience ?? null,
          }], "id");
          await sbUpsert("transcripts", [{
            episode_id: episodeId,
            segments,
            edited: r.edited_transcript ?? null,
            article: r.article ?? null,
            mindmap: r.mindmap ?? null,
            insights: r.insights ?? null,
            chapters: r.chapters ?? null,
            llm: !!r.llm,
            quality_note: r.quality_note ?? null,
            status: "done",
            updated_at: new Date().toISOString(),
          }], "episode_id");
          console.log(`[analyze-job] ${episodeId} 已同步到 Supabase`);
        } catch (e) {
          console.error(`[analyze-job] ${episodeId} 同步失败：`, e instanceof Error ? e.message : e);
        }
      }
      try {
        await writeFile(fileOf(episodeId), JSON.stringify(job), "utf8");
      } catch { /* 写不进去也不影响内存里的状态 */ }
    }
  })();

  return job;
}
