'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get, endpoints } from '@/lib/api';

interface Platform { users: number; canteens: number; stalls: number; dishes: number; todayOrders: number; pendingReviews: number; lowStock: number }
interface Merchant {
  date: string; todayOrderCount: number; todayReservationCount: number; completedCount: number; pendingOrders: number;
  cancelledCount: number; expiredCount: number; simulatedRevenueCents: number; hotDishes: { name: string; count: number }[];
  lowStockAlerts: { id: string; dish: string; remaining: number }[]; revenueNote: string;
}

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';

export default function AdminDashboard() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<{ role: string }>(endpoints.me) });
  const admin = me.data?.role === 'ADMIN';
  const platform = useQuery({ queryKey: ['admin-dashboard'], enabled: admin, queryFn: () => get<Platform>('/admin/dashboard') });
  const merchant = useQuery({ queryKey: ['merchant-dashboard'], queryFn: () => get<Merchant>('/analytics/merchant/dashboard') });

  const p = platform.data;
  const m = merchant.data;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">{admin ? '平台数据看板' : '档口数据看板'}</h1>
        {m && <p className="mt-1 text-[11px] text-muted">供餐日期 {m.date}</p>}
      </div>

      {platform.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">看板加载失败，可能当前账号不是管理员。</p>}

      {admin && <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['今日订单', p?.todayOrders],
          ['待处理评价', p?.pendingReviews],
          ['库存预警', p?.lowStock],
          ['用户', p?.users],
          ['食堂', p?.canteens],
          ['菜品', p?.dishes],
        ].map(([label, value]) => (
          <div key={String(label)} className={card}>
            <p className="text-[11px] text-muted">{label}</p>
            <p className="mt-1 text-xl font-bold">{value ?? '—'}</p>
          </div>
        ))}
      </section>}
      {merchant.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">经营数据加载失败。</p>}

      <section className="grid gap-3 lg:grid-cols-2">
        <div className={card}>
          <h2 className="text-sm font-bold">今日经营</h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-[11px] text-muted">有效预约</p><p className="text-base font-bold">{m?.todayReservationCount ?? '—'}</p></div>
            <div><p className="text-[11px] text-muted">已完成</p><p className="text-base font-bold">{m?.completedCount ?? '—'}</p></div>
            <div><p className="text-[11px] text-muted">待处理</p><p className="text-base font-bold text-orange-deep">{m?.pendingOrders ?? '—'}</p></div>
          </div>
          <p className="mt-3 text-[11px] text-muted">
            完成订单金额 ¥{m ? (m.simulatedRevenueCents / 100).toFixed(2) : '—'}{m && `（${m.revenueNote}）`}
          </p>
          {m && <p className="mt-1 text-[11px] text-muted">共 {m.todayOrderCount} 单 · 取消 {m.cancelledCount} 单 · 过期 {m.expiredCount} 单</p>}
          <Link href="/admin/orders" className="mt-3 inline-block text-xs font-semibold text-orange-deep">去订单操作台 →</Link>
        </div>

        <div className={card}>
          <h2 className="text-sm font-bold">热门菜品</h2>
          {m && m.hotDishes.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2 text-xs">
              {m.hotDishes.map((d) => <li key={d.name} className="flex justify-between"><span>{d.name}</span><span className="text-muted">{d.count} 份</span></li>)}
            </ul>
          ) : <p className="mt-3 text-xs text-muted">今日还没有订单数据。</p>}
        </div>
      </section>

      <section className={card}>
        <h2 className="text-sm font-bold">库存预警</h2>
        {m && m.lowStockAlerts.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {m.lowStockAlerts.map((a) => <li key={a.id} className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">{a.dish} · 剩 {a.remaining}</li>)}
          </ul>
        ) : <p className="mt-3 text-xs text-muted">暂无库存预警（剩余 ≤ 3 时提示）。</p>}
      </section>

      <p className="text-[11px] leading-5 text-muted">
        改进建议只在结构化反馈样本足够时生成，不在无数据时给出经营结论；审核隐藏评价不影响评分统计与用户画像。
      </p>
    </div>
  );
}
