import { Suspense } from "react";
import { DashboardClient } from "./dashboard-client";
import { GUEST_EPISODES, GUEST_TOPICS } from "@/lib/guest/data";

/**
 * 打开就是书斋：不再询问登录。
 *
 * 这里的清单是「公开索引」（真实播客的元数据），任何人都能看；
 * 自己粘进来的链接、写的余音，由客户端从浏览器本机叠加进来；
 * 云端（Supabase）的 400+ 期由客户端再拉一次合并。
 */
function Fallback() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F6F3EA", color: "#7a5a3e", fontSize: 14 }}>
      正在打开书斋…
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <DashboardClient episodes={GUEST_EPISODES} topics={GUEST_TOPICS} />
    </Suspense>
  );
}
