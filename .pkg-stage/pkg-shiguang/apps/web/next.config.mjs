import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

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
export default function config(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  const apiOrigin = (process.env.SHIGUANG_API_ORIGIN || 'http://127.0.0.1:3001').replace(/\/$/, '');
  return {
    ...nextConfig,
    env: { ...nextConfig.env, NEXT_PUBLIC_API_BASE_URL: '/api/v1' },
    async rewrites() {
      return [
        { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
        { source: '/uploads/:path*', destination: `${apiOrigin}/uploads/:path*` },
      ];
    },
  };
}
