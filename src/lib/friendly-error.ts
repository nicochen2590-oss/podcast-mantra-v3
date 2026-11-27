/** 把底层异常翻译成用户看得懂的一句话 */
export function friendlyError(e: unknown, fallback = "出了点问题，请稍后再试"): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const raw = msg || fallback;
  if (/aborted|timeout|timed out|ETIMEDOUT|AbortError/i.test(raw)) {
    return "网络超时，请重试";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(raw)) {
    return "连不上服务器，检查一下网络再试";
  }
  if (/HTTP 4\d\d|HTTP 5\d\d/.test(raw)) {
    return "对方平台拒绝了这次请求，稍后再试";
  }
  if (/429|rate limit|too many/i.test(raw)) {
    return "请求太频繁了，等一分钟再试";
  }
  if (/JSON|Unexpected token|parse/i.test(raw) && raw.length < 120) {
    return "解析结果不对，可能是链接失效了";
  }
  // 已经是我们自己写的中文提示就原样返回
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  return fallback;
}
