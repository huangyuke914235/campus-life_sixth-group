'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';

interface Analysis {
  totalReviews: number;
  ratingDistribution: Record<string, number>;
  feelingStats: { code: string; label: string; count: number; ratio: number }[];
  suggestions: string[];
  recentReviews: { id: string; dish: string; rating: number; comment: string | null; status: string; createdAt: string }[];
}
interface AllReview {
  id: string; rating: number; comment: string | null; status: string; source: string; createdAt: string;
  feelings: { code: string; label: string }[];
  user: { displayName: string; email: string };
  dish: { id: string; name: string; stall: { name: string; canteen: { name: string } } };
}

const card = 'rounded-card border border-line bg-white p-4 dark:bg-[#262B24]';
const STATUS_TABS = [
  { k: 'ALL', t: '全部' },
  { k: 'VISIBLE', t: '可见' },
  { k: 'HIDDEN', t: '已隐藏' },
];

export default function AdminReviewsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'merchant' | 'all'>('merchant');
  const [status, setStatus] = useState('ALL');

  const data = useQuery({ queryKey: ['merchant-reviews'], queryFn: () => get<Analysis>('/analytics/merchant/reviews') });
  const all = useQuery({
    queryKey: ['admin-all-reviews', status],
    enabled: tab === 'all',
    queryFn: () => get<{ items: AllReview[]; meta: { total: number } }>(`/admin/reviews?pageSize=40&status=${status}`),
  });

  const moderate = useMutation({
    mutationFn: ({ id, status: s }: { id: string; status: string }) => patch(`/admin/reviews/${id}/moderate`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-reviews'] });
      qc.invalidateQueries({ queryKey: ['admin-all-reviews'] });
    },
  });

  const d = data.data;
  const max = d ? Math.max(1, ...Object.values(d.ratingDistribution)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">评价管理</h1>
        <p className="mt-1 text-[11px] text-muted">
          「档口分析」看自己档口的均分与改进建议；「全站评价」是管理员视图，能看到所有人的评价（含已隐藏）
        </p>
      </div>

      <div className="flex gap-2">
        {[{ k: 'merchant', t: '档口分析' }, { k: 'all', t: '全站评价（含隐藏）' }].map((x) => (
          <button key={x.k} type="button" onClick={() => setTab(x.k as 'merchant' | 'all')}
            aria-pressed={tab === x.k}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${tab === x.k ? 'bg-orange text-white' : 'border border-line text-muted'}`}>
            {x.t}
          </button>
        ))}
      </div>

      {tab === 'merchant' && (
        <>
          {data.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">加载失败，可能当前账号没有该档口权限。</p>}

          <section className="grid gap-3 lg:grid-cols-2">
            <div className={card}>
              <h2 className="text-sm font-bold">评分分布（共 {d?.totalReviews ?? 0} 条）</h2>
              <div className="mt-3 flex flex-col gap-1.5">
                {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((star) => {
                  const count = d?.ratingDistribution[String(star)] ?? 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-muted">{star} 星</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-beige dark:bg-[#2F362D]">
                        <div className="h-full rounded-full bg-orange" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={card}>
              <h2 className="text-sm font-bold">常见体感反馈</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {d?.feelingStats.length ? d.feelingStats.map((f) => (
                  <span key={f.code} className="sg-chip">{f.label} · {f.count}（{Math.round(f.ratio * 100)}%）</span>
                )) : <span className="text-xs text-muted">暂无反馈数据</span>}
              </div>
            </div>
          </section>

          <section className={card}>
            <h2 className="text-sm font-bold">菜品改进建议</h2>
            <ul className="mt-3 flex flex-col gap-2 text-xs leading-5">
              {(d?.suggestions ?? []).map((s) => <li key={s} className="rounded-xl bg-sage-light px-3 py-2 text-sage-deep">{s}</li>)}
              {!d?.suggestions.length && <li className="text-muted">暂无建议。</li>}
            </ul>
          </section>

          <section className={card}>
            <h2 className="text-sm font-bold">最近评价</h2>
            <div className="mt-3 flex flex-col gap-3">
              {(d?.recentReviews ?? []).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 border-b border-line pb-2 last:border-0">
                  <div>
                    <p className="text-xs font-semibold">{r.dish} · {r.rating} 星 {r.status === 'HIDDEN' && <span className="text-muted">（已隐藏）</span>}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{r.comment ?? '未填写短评'} · {new Date(r.createdAt).toLocaleDateString('zh-CN')}</p>
                  </div>
                  <button type="button" onClick={() => moderate.mutate({ id: r.id, status: r.status === 'HIDDEN' ? 'VISIBLE' : 'HIDDEN' })}
                    className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
                    {r.status === 'HIDDEN' ? '恢复显示' : '隐藏'}
                  </button>
                </div>
              ))}
              {!d?.recentReviews.length && <p className="text-xs text-muted">暂无评价。</p>}
            </div>
          </section>
        </>
      )}

      {tab === 'all' && (
        <>
          <div className="flex items-center gap-2">
            {STATUS_TABS.map((s) => (
              <button key={s.k} type="button" onClick={() => setStatus(s.k)} aria-pressed={status === s.k}
                className={`sg-chip ${status === s.k ? 'sg-chip-active' : ''}`}>{s.t}</button>
            ))}
            <span className="ml-auto text-[11px] text-muted">共 {all.data?.meta.total ?? '—'} 条</span>
          </div>

          {all.isPending && <div className="sg-skeleton h-40" />}
          {all.isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">加载失败，需要管理员权限。</p>}

          <div className="flex flex-col gap-2">
            {all.data?.items.map((r) => (
              <article key={r.id} className="rounded-card border border-line bg-white p-3 dark:bg-[#262B24]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      {r.user.displayName} <span className="font-normal text-muted">({r.user.email})</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {r.dish.stall.canteen.name} · {r.dish.stall.name} · {r.dish.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.status === 'HIDDEN' ? 'bg-red-50 text-red-700' : 'bg-sage-light text-sage-deep'}`}>
                      {r.status === 'HIDDEN' ? '已隐藏' : '可见'}
                    </span>
                    <button type="button" onClick={() => moderate.mutate({ id: r.id, status: r.status === 'HIDDEN' ? 'VISIBLE' : 'HIDDEN' })}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
                      {r.status === 'HIDDEN' ? '恢复' : '隐藏'}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs">
                  <span className="text-orange-deep">{r.rating} 星</span>
                  {r.comment ? ` · ${r.comment}` : ' · 未填写短评'}
                </p>
                {r.feelings.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.feelings.map((f) => <span key={f.code} className="sg-chip">{f.label}</span>)}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-muted">
                  {new Date(r.createdAt).toLocaleString('zh-CN')} · {r.source === 'VERIFIED_ORDER' ? '已核验订单' : '线下补评'}
                </p>
              </article>
            ))}
          </div>
          {all.data?.items.length === 0 && <p className="text-xs text-muted">该状态下没有评价。</p>}
          <p className="text-[11px] leading-5 text-muted">隐藏只影响前台展示，不改评分统计与用户画像。</p>
        </>
      )}
    </div>
  );
}
