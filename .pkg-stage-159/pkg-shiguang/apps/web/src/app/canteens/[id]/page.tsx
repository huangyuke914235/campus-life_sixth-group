'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';

interface Stall { id: string; name: string; description: string | null; floor: string | null; windowNo: string | null; openTime: string | null; closeTime: string | null }
interface CanteenDetail {
  id: string; name: string; description: string | null; location: string;
  openTime: string; closeTime: string; currentlyOpen: boolean; notice: string | null;
  stalls: Stall[];
  announcements: { id: string; title: string; body: string; publishedAt: string | null }[];
}

export default function CanteenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({ queryKey: ['canteen', id], queryFn: () => get<CanteenDetail>(`/canteens/${id}`) });
  const today = new Date().toISOString().slice(0, 10);
  const menus = useQuery({
    queryKey: ['canteen-menus', id, today],
    queryFn: () => get<{ stallId: string; items: { dishId: string; dish: { id: string; name: string; priceCents: number } }[] }[]>(`/menus?date=${today}&canteenId=${id}`),
  });

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <Link href="/canteens" className="text-xs text-muted">← 食堂列表</Link>

      {detail.isPending && <div className="sg-skeleton mt-4 h-36" />}
      {detail.isError && <p role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">食堂加载失败。</p>}

      {detail.data && (
        <>
          <header className="mt-3">
            <h1 className="text-xl font-bold">{detail.data.name}</h1>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><MapPin size={12} aria-hidden />{detail.data.location}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
              <span className={`rounded-full px-2 py-1 ${detail.data.currentlyOpen ? 'bg-sage-light text-sage-deep' : 'bg-beige'}`}>
                {detail.data.currentlyOpen ? '营业中' : '已休息'}
              </span>
              <span className="flex items-center gap-1"><Clock size={12} aria-hidden />{detail.data.openTime}–{detail.data.closeTime}</span>
            </div>
            {detail.data.description && <p className="mt-2 text-xs leading-5 text-muted">{detail.data.description}</p>}
            {detail.data.notice && <p className="mt-2 rounded-xl bg-orange-light p-2 text-[11px] text-orange-deep">{detail.data.notice}</p>}
          </header>

          {detail.data.announcements.length > 0 && (
            <section className="sg-card mt-4 p-4">
              <h2 className="text-sm font-bold">食堂公告</h2>
              <div className="mt-2 flex flex-col gap-2">
                {detail.data.announcements.map((a) => (
                  <div key={a.id} className="border-b border-line pb-2 last:border-0">
                    <p className="text-xs font-semibold">{a.title}</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted">{a.body}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-4">
            <h2 className="text-sm font-bold">档口（{detail.data.stalls.length}）</h2>
            <div className="mt-2 flex flex-col gap-2">
              {detail.data.stalls.map((s) => {
                const menu = menus.data?.find((m) => m.stallId === s.id);
                return (
                  <div key={s.id} className="sg-card p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-bold">{s.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {[s.floor, s.windowNo ? `${s.windowNo} 号窗` : null].filter(Boolean).join(' · ') || '位置见现场指引'}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted">{menu ? `今日 ${menu.items.length} 道` : '今日未发布'}</span>
                    </div>
                    {s.description && <p className="mt-1 line-clamp-1 text-[11px] text-muted">{s.description}</p>}
                    {menu && menu.items.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {menu.items.slice(0, 4).map((i) => (
                          <Link key={i.dishId} href={`/dishes/${i.dish.id}`} className="sg-chip">{i.dish.name}</Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <Link href="/discover" className="sg-btn-primary mt-5 block text-center">去探索全部菜品</Link>
        </>
      )}
      <BottomNav />
    </main>
  );
}
