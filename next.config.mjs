/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 默认拦截跨域开发资源；允许本机两种回环地址访问，
  // 否则用 127.0.0.1 打开时 HMR/客户端脚本被挡，React 无法水合、按钮点不动。
  allowedDevOrigins: ["127.0.0.1", "localhost", "10.31.56.201", "10.31.85.122"],
  // ffmpeg 是平台相关的原生二进制，不能被打包器改写路径；
  // 交给 Node 运行时按真实 node_modules 解析，并确保部署时二进制被带上。
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/transcribe": ["./node_modules/@ffmpeg-installer/**"],
  },
};

export default nextConfig;
