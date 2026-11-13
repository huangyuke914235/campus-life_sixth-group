'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, endpoints } from '@/lib/api';

const NAV = [
  { href: '/admin', label: '数据看板' },
  { href: '/admin/orders', label: '订单操作台' },
  { href: '/admin/dishes', label: '菜品' },
  { href: '/admin/menus', label: '每日菜单' },
  { href: '/admin/reviews', label: '评价与改进' },
  { href: '/admin/canteens', label: '食堂', adminOnly: true },
  { href: '/admin/stalls', label: '档口', adminOnly: true },
  { href: '/admin/users', label: '用户与角色', adminOnly: true },
  { href: '/admin/settings', label: '系统设置', adminOnly: true },
  { href: '/admin/audit', label: '操作日志', adminOnly: true },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<{ role: string }>(endpoints.me) });
  if (me.isPending) return <main className="mx-auto max-w-6xl p-5"><div className="sg-skeleton h-28" /></main>;
  if (me.isError) return <main className="mx-auto max-w-6xl p-5"><p role="alert">后台登录信息加载失败。</p><Link href="/login">前往登录</Link></main>;
  const admin = me.data.role === 'ADMIN';
  const permitted = admin || (me.data.role === 'MERCHANT' && !NAV.some((item) => item.adminOnly && item.href === pathname));
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
          {permitted && NAV.filter((n) => admin || !n.adminOnly).map((n) => {
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
      <main className="mx-auto max-w-6xl px-5 py-6">{permitted ? children : <p role="alert">当前账号无权访问此管理页面。</p>}</main>
    </div>
  );
}
