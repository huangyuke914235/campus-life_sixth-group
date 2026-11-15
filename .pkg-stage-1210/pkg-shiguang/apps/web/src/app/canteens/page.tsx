'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';

interface Canteen {
  id: string; name: string; description: string | null; location: string;
  openTime: string; closeTime: string; currentlyOpen: boolean;
  stallCount: number; latestAnnouncement: string | null;
}

export default function CanteensPage() {
  const list = useQuery({ queryKey: ['canteens'], queryFn: () => get<Canteen[]>('/canteens') });

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">食堂与档口</h1>
        <p className="mt-1 text-xs text-muted">按食堂查看档口、营业时间与今日菜单</p>
      </header>

      {list.isPending && <div className="mt-5 flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-28" />)}</div>}
      {list.isError && <p role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">食堂列表加载失败。</p>}
      {list.data?.length === 0 && <p className="mt-5 text-xs text-muted">暂无食堂数据。</p>}

      <div className="mt-5 flex flex-col gap-3">
        {list.data?.map((c) => (
          <Link key={c.id} href={`/canteens/${c.id}`} className="sg-card block p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold">{c.name}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><MapPin size={12} aria-hidden />{c.location}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] ${c.currentlyOpen ? 'bg-sage-light text-sage-deep' : 'bg-beige text-muted'}`}>
                {c.currentlyOpen ? '营业中' : '已休息'}
              </span>
            </div>
            {c.description && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted">{c.description}</p>}
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1"><Clock size={12} aria-hidden />{c.openTime}–{c.closeTime}</span>
              <span>{c.stallCount} 个档口</span>
            </div>
            {c.latestAnnouncement && (
              <p className="mt-2 rounded-lg bg-orange-light px-2 py-1.5 text-[11px] text-orange-deep">公告：{c.latestAnnouncement}</p>
            )}
          </Link>
        ))}
      </div>
      <BottomNav />
    </main>
  );
}
