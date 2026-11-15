/** @type {import('next').NextConfig} */
const nextConfig = {
  // 部分 Windows / 受管环境不允许在 `.next` 下创建 trace 文件（EPERM），
  // 这里改用普通目录；Dockerfile.web 已同步使用 dist。
  distDir: 'dist',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1' },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default nextConfig;
