'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';

interface Report {
  mealsThisMonth: number;
  avgSpendCents: number | null;
  topDishes: { name: string; count: number }[];
  favoriteCategories: string[];
  highRatedDishes: { name: string; rating: number }[];
  reviewCount: number;
  note: string;
}

export default function InsightsPage() {
  const report = useQuery({ queryKey: ['my-report'], queryFn: () => get<Report>('/analytics/my-report') });
  const profile = useQuery({ queryKey: ['taste-profile'], queryFn: () => get<{ summary: string; inferred: { confidence: number; topTags: string[] } | null }>('/preferences/profile') });
  const r = report.data;
  const maxCount = Math.max(1, ...(r?.topDishes.map((d) => d.count) ?? [1]));

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">我的饮食报告</h1>
        <p className="mt-1 text-xs text-muted">基于真实订单与评价统计，不含推测数据</p>
      </header>

      {report.isPending && <div className="sg-skeleton mt-5 h-32" />}
      {report.isError && <p role="alert" className="sg-card mt-5 p-4 text-xs text-red-700">报告加载失败。</p>}

      {r && (
        <>
          <section className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="sg-card p-3"><p className="text-[11px] text-muted">本月用餐</p><p className="mt-1 text-sm font-bold">{r.mealsThisMonth} 次</p></div>
            <div className="sg-card p-3"><p className="text-[11px] text-muted">平均客单</p><p className="mt-1 text-sm font-bold">{r.avgSpendCents === null ? '—' : `¥${(r.avgSpendCents / 100).toFixed(1)}`}</p></div>
            <div className="sg-card p-3"><p className="text-[11px] text-muted">评价条数</p><p className="mt-1 text-sm font-bold">{r.reviewCount}</p></div>
          </section>

          <section className="sg-card mt-4 p-4">
            <h2 className="text-sm font-bold">常点菜品</h2>
            {r.topDishes.length === 0 ? <p className="mt-2 text-xs text-muted">还没有已完成的订单。</p> : (
              <div className="mt-3 flex flex-col gap-2">
                {r.topDishes.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 shrink-0 truncate">{d.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-beige dark:bg-[#2F362D]">
                      <div className="h-full rounded-full bg-orange" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-muted">{d.count} 次</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="sg-card mt-4 p-4">
            <h2 className="text-sm font-bold">偏好分类（来自高分评价）</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.favoriteCategories.length > 0
                ? r.favoriteCategories.map((c) => <span key={c} className="sg-chip bg-sage-light text-sage-deep">{c}</span>)
                : <span className="text-xs text-muted">评分样本不足，暂不生成结论。</span>}
            </div>
          </section>

          <section className="sg-card mt-4 p-4">
            <h2 className="text-sm font-bold">你给高分的菜</h2>
            {r.highRatedDishes.length === 0 ? <p className="mt-2 text-xs text-muted">还没有 4 星以上的评价。</p> : (
              <ul className="mt-2 flex flex-col gap-1.5 text-xs">
                {r.highRatedDishes.map((d) => (
                  <li key={d.name} className="flex justify-between"><span>{d.name}</span><span className="text-orange-deep">{d.rating} 星</span></li>
                ))}
              </ul>
            )}
          </section>

          <section className="sg-card mt-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">口味画像</h2>
              <Link href="/profile/preferences" className="text-[11px] text-orange-deep">查看详情 →</Link>
            </div>
            <p className="mt-2 text-xs leading-5">{profile.data?.summary ?? '—'}</p>
            {profile.data?.inferred && (
              <p className="mt-1 text-[11px] text-muted">置信度 {Math.round(profile.data.inferred.confidence * 100)}% · 可随时重置</p>
            )}
          </section>

          <p className="mt-4 text-[11px] leading-5 text-muted">{r.note}</p>
        </>
      )}
      <BottomNav />
    </main>
  );
}
