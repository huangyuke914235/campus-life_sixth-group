'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/admin', label: '数据看板' },
  { href: '/admin/orders', label: '订单操作台' },
  { href: '/admin/dishes', label: '菜品' },
  { href: '/admin/menus', label: '每日菜单' },
  { href: '/admin/reviews', label: '评价与改进' },
  { href: '/admin/canteens', label: '食堂' },
  { href: '/admin/stalls', label: '档口' },
  { href: '/admin/users', label: '用户与角色' },
  { href: '/admin/settings', label: '系统设置' },
  { href: '/admin/audit', label: '操作日志' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-beige dark:bg-[#1C201B]">
      <header className="border-b border-line bg-white dark:bg-[#262B24]">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange text-sm font-bold text-white">食</span>
            <span className="text-sm font-bold">食光有数 · 后台</span>
          </Link>
          <Link href="/dashboard" className="ml-auto text-[11px] text-muted">返回学生端 →</Link>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 pb-2 sg-scroll" aria-label="后台导航">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium ${active ? 'bg-orange text-white' : 'text-muted hover:bg-beige dark:hover:bg-[#2F362D]'}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
    </div>
  );
}
