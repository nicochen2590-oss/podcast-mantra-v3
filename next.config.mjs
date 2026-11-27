/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 默认拦截跨域开发资源；允许本机两种回环地址访问，
  // 否则用 127.0.0.1 打开时 HMR/客户端脚本被挡，React 无法水合、按钮点不动。
  allowedDevOrigins: ["127.0.0.1", "localhost", "10.31.56.201", "10.31.85.122"],
  // 不再把 @ffmpeg-installer/ffmpeg 声明为外部包：
  // 它只在「本机转写」时用，云端没有这个包，写死会导致构建解析失败。
};

export default nextConfig;
