'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Sparkles, ReceiptText, User } from 'lucide-react';

const TABS = [
  { href: '/dashboard', label: '首页', Icon: Home },
  { href: '/recommend', label: '选菜', Icon: Sparkles },
  { href: '/reviews', label: '评价', Icon: MessageSquare },
  { href: '/orders', label: '订单', Icon: ReceiptText },
  { href: '/profile', label: '我的', Icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-5 pb-5 pt-3" aria-label="主导航">
      <div className="mx-auto flex h-[62px] max-w-md items-center gap-1 rounded-[36px] border border-line bg-white p-1 shadow-soft dark:bg-[#262B24]">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-[26px] py-2 text-[10px] transition-colors ${active ? 'bg-orange font-semibold text-white' : 'text-muted'}`}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
