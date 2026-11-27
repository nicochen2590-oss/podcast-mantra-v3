"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Episode } from "./types";

// 模块级锁：React StrictMode 会双挂载 effect，防止两条轮询链同时打免费接口
let busy = false;

export type TranscribeProgress = Record<string, { cursorSec: number; totalSec: number }>;

/**
 * 无 UI 的自动转写驱动器。
 * 只要列表里存在「待誊写 / 誊写中」的内容，就串行推进 /api/transcribe，
 * 每次只转一小片，直到全部已成文。关掉页面、刷新、换设备后靠数据库游标续传。
 * 不依赖 cron（Vercel Hobby 每天只有一次），完全由打开的页面驱动。
 */
export function TranscribeDriver({
  episodes,
  onProgress,
}: {
  episodes: Episode[];
  onProgress?: (p: TranscribeProgress) => void;
}) {
  const router = useRouter();
  const epsRef = useRef(episodes);
  epsRef.current = episodes;
  const skippedRef = useRef<Set<string>>(new Set());

  // 只有「未完成」的 id 集合变化时才重挂轮询链
  // 含 failed：打开页面时给它一次重试机会（每期本次会话只试一次，不会死循环）
  const key = episodes
    .filter((e) => e.transcript_status !== "ready")
    .map((e) => e.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (stopped) return;
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (stopped) return;
      if (busy) { schedule(500); return; }

      const target = epsRef.current.find(
        (e) => e.transcript_status !== "ready" && !skippedRef.current.has(e.id)
      );
      if (!target) return; // 全部完成，停止轮询

      busy = true;
      let wait = 500;
      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ episodeId: target.id }),
        });
        const j = await res.json();

        if (j.status === "no_key") return; // 未配密钥，重试没意义
        if (j.status === "failed") {
          skippedRef.current.add(target.id); // 单期问题，跳过它继续下一期
          wait = 300;
        } else {
          if (typeof j.cursorSec === "number") {
            onProgress?.({ [target.id]: { cursorSec: j.cursorSec, totalSec: j.totalSec ?? 0 } });
          }
          if (j.status === "ready") {
            wait = 250;
            router.refresh(); // 让服务端数据（逐字稿/状态）刷新到界面
          } else {
            wait = 400; // 每片之间留一点，尊重免费模型的速率限制
          }
        }
      } catch {
        wait = 2500; // 网络抖动退避，不猛冲
      } finally {
        busy = false;
        schedule(wait);
      }
    };

    schedule(350);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router]);

  return null;
}
