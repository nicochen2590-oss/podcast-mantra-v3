import { notFound } from "next/navigation";
import { GuestEpisodeView } from "./guest-episode";
import { findGuestEpisode, isLocalEpisodeId } from "@/lib/guest/data";

/**
 * 详情页不再区分登录 / 未登录，只有一种：本机书斋里的一期。
 *
 * 公开索引里的期（含示例那一期）在服务端就能拿到，作为初始值传下去；
 * 自己粘进来的那一期只存在浏览器里，服务端查不到，交给客户端读回来。
 */
export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seed = findGuestEpisode(id);
  // 本地索引没有 → 问云端（共享库里可能有这一期）
  let cloud = null;
  if (!seed && !isLocalEpisodeId(id)) {
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
      const res = await fetch(`${base}/api/transcript/${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.episode) notFound();
      cloud = j.episode;
    } catch {
      notFound();
    }
  }
  return <GuestEpisodeView id={id} seed={seed} cloud={cloud} />;
}
