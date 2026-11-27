import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const refreshed: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
            refreshed.push({ name, value, options: options as Record<string, unknown> });
          });
        },
      },
    }
  );

  // 用 getSession()：只读 cookie，不向 Supabase 发网络请求。
  // getUser() 每次都联网校验，网络抖动时会误判未登录 → 需要反复登录才能进。
  // token 有效性由各 API / Server Component 的 getUser() 再做真正校验。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // 打开就是书斋：这里不再拦任何人，也不再有 /login 跳转。
  // 保留 session 读取与 cookie 刷新，是为了以后要接回云端同步时不用重写；
  // 现在没人登录，这段实际上什么也不做。
  void user;
  void refreshed;

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
