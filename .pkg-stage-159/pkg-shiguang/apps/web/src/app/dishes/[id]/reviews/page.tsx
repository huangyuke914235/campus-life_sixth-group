'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { StarRating } from '@/components/StarRating';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';

interface ReviewRow {
  id: string; rating: number; comment: string | null; source: string; createdAt: string;
  feelings: { code: string; label: string }[];
  user: { displayName: string; avatarUrl: string | null };
}
interface Page {
  items: ReviewRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  distribution: Record<string, number>;
}

export default function DishReviewsPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [all, setAll] = useState<ReviewRow[]>([]);

  const list = useQuery({
    queryKey: ['dish-reviews', id, page],
    queryFn: async () => {
      const d = await get<Page>(`/reviews/dish/${id}?page=${page}&pageSize=10`);
      setAll((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...d.items.filter((x) => !seen.has(x.id))];
      });
      return d;
    },
  });

  const d = list.data;
  const total = d?.meta.total ?? 0;
  const avg = (() => {
    if (!d) return 0;
    const sum = Object.entries(d.distribution).reduce((s, [k, v]) => s + Number(k) * v, 0);
    return total > 0 ? sum / total : 0;
  })();
  const maxBar = Math.max(1, ...Object.values(d?.distribution ?? { 1: 1 }));

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <Link href={`/dishes/${id}`} className="text-xs text-muted">← 菜品详情</Link>
      <header className="mt-3">
        <h1 className="text-xl font-bold">全部评价</h1>
        <p className="mt-1 text-xs text-muted">共 {total} 条 · 含已核验订单与线下补评</p>
      </header>

      {d && total > 0 && (
        <section className="sg-card mt-4 p-4">
          <div className="flex items-end gap-4">
            <div>
              <p className="text-3xl font-bold text-orange-deep">{avg.toFixed(1)}</p>
              <StarRating value={Math.round(avg)} onChange={() => {}} readOnly size={16} />
            </div>
            <div className="flex-1">
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((s) => {
                const c = d.distribution[String(s)] ?? 0;
                return (
                  <div key={s} className="flex items-center gap-2 text-[11px]">
                    <span className="w-6 text-muted">{s} 星</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-beige dark:bg-[#2F362D]">
                      <div className="h-full rounded-full bg-orange" style={{ width: `${(c / maxBar) * 100}%` }} />
                    </div>
                    <span className="w-6 text-right text-muted">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <Link href={`/dishes/${id}/review`} className="sg-btn-primary mt-3 block text-center text-xs">我也吃过，写个评价</Link>

      {list.isPending && page === 1 && <div className="mt-4 flex flex-col gap-2">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-20" />)}</div>}
      {list.isError && <p role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">评价加载失败。</p>}
      {d && total === 0 && (
        <div className="sg-card mt-4 p-6 text-center">
          <p className="text-sm font-semibold">还没有评价</p>
          <p className="mt-1 text-xs text-muted">成为第一个评价这道菜的人。</p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {all.map((r) => (
          <article key={r.id} className="sg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{r.user.displayName}</p>
              <div className="flex items-center gap-1">
                <StarRating value={r.rating} onChange={() => {}} readOnly size={12} />
                <span className="text-[11px] text-muted">{r.rating} 星</span>
              </div>
            </div>
            {r.comment && <p className="mt-2 text-xs leading-5">{r.comment}</p>}
            {r.feelings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.feelings.map((f) => <span key={f.code} className="sg-chip">{f.label}</span>)}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">
              {new Date(r.createdAt).toLocaleDateString('zh-CN')} · {r.source === 'VERIFIED_ORDER' ? '已核验订单' : '线下补评'}
            </p>
          </article>
        ))}
      </div>

      {d && page < d.meta.totalPages && (
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={list.isFetching}
          className="mt-4 w-full rounded-pill border border-line py-2.5 text-xs font-semibold text-muted disabled:opacity-50">
          {list.isFetching ? '加载中…' : `加载更多（${all.length}/${total}）`}
        </button>
      )}
      <BottomNav />
    </main>
  );
}
