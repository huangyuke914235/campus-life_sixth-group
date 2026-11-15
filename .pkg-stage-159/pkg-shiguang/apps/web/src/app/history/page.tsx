'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';

interface HistoryDay {
  date: string; items: string[]; totalCents: number; energyKcal: number; estimated: boolean;
}
interface OrderRow { id: string; number: string; status: string; totalCents: number; createdAt: string; items: { dishName: string; quantity: number }[]; stall: { name: string } | null }

const STATUS: Record<string, string> = { PENDING: '待确认', CONFIRMED: '已确认', PREPARING: '备餐中', READY: '待取餐', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期' };

export default function HistoryPage() {
  const nutrition = useQuery({ queryKey: ['nutrition-history'], queryFn: () => get<{ days: number; daily: HistoryDay[]; disclaimer: string }>('/nutrition/history') });
  const orders = useQuery({ queryKey: ['order-history'], queryFn: () => get<{ items: OrderRow[] }>('/orders?pageSize=50') });

  const totalSpend = (orders.data?.items ?? []).filter((o) => o.status === 'COMPLETED').reduce((s, o) => s + o.totalCents, 0);
  const completedCount = (orders.data?.items ?? []).filter((o) => o.status === 'COMPLETED').length;
  const totalKcal = (nutrition.data?.daily ?? []).reduce((s, d) => s + d.energyKcal, 0);

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">饮食记录</h1>
        <p className="mt-1 text-xs text-muted">近 30 天的用餐与营养估算</p>
      </header>

      <section className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['用餐次数', completedCount],
          ['累计花费', `¥${(totalSpend / 100).toFixed(0)}`],
          ['估算热量', `${totalKcal} kcal`],
        ].map(([k, v]) => (
          <div key={String(k)} className="sg-card p-3">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="mt-1 text-sm font-bold">{v}</p>
          </div>
        ))}
      </section>

      {nutrition.isError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">营养记录加载失败。</p>}

      <section className="mt-5">
        <h2 className="text-sm font-bold">按日汇总</h2>
        {nutrition.isPending && <div className="sg-skeleton mt-2 h-24" />}
        {nutrition.data?.daily.length === 0 && <p className="mt-2 text-xs text-muted">近 30 天还没有已完成的用餐记录。</p>}
        <div className="mt-2 flex flex-col gap-2">
          {nutrition.data?.daily.map((d, i) => (
            <div key={`${d.date}-${i}`} className="sg-card flex items-center justify-between p-3 text-xs">
              <div>
                <p className="font-semibold">{d.date}</p>
                <p className="mt-0.5 text-[11px] text-muted">{d.items.join('、')}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">¥{(d.totalCents / 100).toFixed(0)}</p>
                <p className="text-[11px] text-muted">{d.energyKcal} kcal{d.estimated ? '（估算）' : ''}</p>
              </div>
            </div>
          ))}
        </div>
        {nutrition.data && <p className="mt-2 text-[11px] leading-5 text-muted">{nutrition.data.disclaimer}</p>}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">全部订单</h2>
          <Link href="/insights" className="text-[11px] text-orange-deep">看饮食报告 →</Link>
        </div>
        {orders.isPending && <div className="sg-skeleton mt-2 h-24" />}
        <div className="mt-2 flex flex-col gap-2">
          {orders.data?.items.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="sg-card flex items-center justify-between p-3 text-xs">
              <div>
                <p className="font-semibold">{o.items.map((i) => i.dishName).join('、')}</p>
                <p className="mt-0.5 text-[11px] text-muted">{o.stall?.name} · {new Date(o.createdAt).toLocaleDateString('zh-CN')}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px]">{STATUS[o.status] ?? o.status}</p>
                <p className="font-semibold">¥{(o.totalCents / 100).toFixed(0)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <BottomNav />
    </main>
  );
}
