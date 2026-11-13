import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: { default: '食光有数 · 荔园智慧膳食服务平台', template: '%s | 食光有数' },
  description: '每一餐，都更懂你的口味。校园菜单公示、提前点餐、预约取餐、饭后评价与个性化菜品推荐。',
  keywords: ['校园食堂', '智慧膳食', '菜品推荐', '预约取餐', '食光有数'],
  manifest: '/manifest.webmanifest',
  openGraph: { title: '食光有数 · 荔园智慧膳食服务平台', description: '每一餐，都更懂你的口味。', type: 'website', locale: 'zh_CN' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#FF8A4C',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
