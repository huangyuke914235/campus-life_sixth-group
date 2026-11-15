'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { StarRating } from '@/components/StarRating';
import { BottomNav } from '@/components/BottomNav';
import { get } from '@/lib/api';
import { resolveDishImage } from '@/lib/dish-image';

interface FeedItem {
  id: string; rating: number; comment: string | null; source: string; createdAt: string;
  feelings: { code: string; label: string }[];
  user: { displayName: string; avatarUrl: string | null };
  dish: { id: string; name: string; imageUrl: string | null; stall: { name: string; canteen: { name: string } } };
}
interface FeedResp {
  items: FeedItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; average: number; distribution: Record<string, number> };
}

const SORTS = [
  { k: 'latest', t: '最新' },
  { k: 'highest', t: '最高分' },
  { k: 'lowest', t: '最低分' },
] as const;
const FILTERS = [
  { k: 'all', t: '全部' },
  { k: 'comment', t: '有短评' },
  { k: 'good', t: '好评 8-10 分' },
  { k: 'bad', t: '差评 1-2 分' },
] as const;

export default function ReviewFeedPage() {
  const [sort, setSort] = useState<(typeof SORTS)[number]['k']>('latest');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('all');
  const feed = useInfiniteQuery({
    queryKey: ['review-feed', sort, filter],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: '15', sort });
      if (filter === 'comment') params.set('withComment', 'true');
      if (filter === 'good') params.set('minRating', '8');
      if (filter === 'bad') params.set('maxRating', '2');
      return get<FeedResp>(`/reviews/feed?${params}`, signal);
    },
    getNextPageParam: (last) => last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
  });

  const all = [...new Map(feed.data?.pages.flatMap((page) => page.items.map((item) => [item.id, item] as const))).values()];
  const d = feed.data?.pages[0];

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <header>
        <h1 className="text-xl font-bold">大家的评价</h1>
        <p className="mt-1 text-xs text-muted">全站真实评价，含已核验订单与线下补评</p>
      </header>

      {d && d.summary.total > 0 && (
        <section className="sg-card mt-4 flex items-center gap-4 p-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-deep">{d.summary.average.toFixed(1)}</p>
            <p className="text-[11px] text-muted">全站均分</p>
          </div>
          <div className="flex-1">
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((s) => {
              const c = d.summary.distribution[String(s)] ?? 0;
              const max = Math.max(1, ...Object.values(d.summary.distribution));
              return (
                <div key={s} className="flex items-center gap-2 text-[11px]">
                  <span className="w-5 text-muted">{s}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-beige dark:bg-[#2F362D]">
                    <div className="h-full rounded-full bg-orange" style={{ width: `${(c / max) * 100}%` }} />
                  </div>
                  <span className="w-6 text-right text-muted">{c}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sg-scroll">
        {SORTS.map((s) => (
          <button key={s.k} type="button" onClick={() => setSort(s.k)} aria-pressed={sort === s.k}
            className={`sg-chip whitespace-nowrap ${sort === s.k ? 'sg-chip-active' : ''}`}>{s.t}</button>
        ))}
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 sg-scroll">
        {FILTERS.map((f) => (
          <button key={f.k} type="button" onClick={() => setFilter(f.k)} aria-pressed={filter === f.k}
            className={`sg-chip whitespace-nowrap ${filter === f.k ? 'sg-chip-active' : ''}`}>{f.t}</button>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted">
        共 {d?.meta.total ?? '—'} 条{d?.meta.total ? `，已显示 ${all.length} 条` : ''}
      </p>

      {feed.isPending && <div className="mt-3 flex flex-col gap-2">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-24" />)}</div>}
      {feed.isError && <p role="alert" className="sg-card mt-3 p-4 text-xs text-red-700">评价加载失败。</p>}

      {all.length === 0 && feed.isSuccess && (
        <div className="sg-card mt-3 p-8 text-center">
          <MessageSquare size={26} className="mx-auto text-muted" aria-hidden />
          <p className="mt-3 text-sm font-semibold">这个条件下还没有评价</p>
          <p className="mt-1 text-xs text-muted">换个筛选看看，或者去给吃过的菜写一条。</p>
          <Link href="/discover" className="sg-btn-primary mt-4 inline-block text-xs">去逛逛</Link>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {all.map((r) => (
          <article key={r.id} className="sg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-beige text-[10px] font-bold dark:bg-[#2F362D]">
                  {r.user.displayName.slice(0, 1)}
                </div>
                <p className="text-xs font-semibold">{r.user.displayName}</p>
              </div>
              <div className="flex items-center gap-1">
                <StarRating value={r.rating} onChange={() => {}} readOnly size={12} />
              </div>
            </div>

            <Link href={`/dishes/${r.dish.id}`} className="mt-2 flex items-center gap-2">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-beige dark:bg-[#2F362D]">
                <img src={resolveDishImage(r.dish.name, r.dish.imageUrl)} alt={r.dish.name} className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-orange-deep">{r.dish.name}</p>
                <p className="text-[11px] text-muted">{r.dish.stall.canteen.name} · {r.dish.stall.name}</p>
              </div>
            </Link>

            {r.comment && <p className="mt-2 text-xs leading-5">{r.comment}</p>}
            {r.feelings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.feelings.map((f) => <span key={f.code} className="sg-chip">{f.label}</span>)}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">
              {new Date(r.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' · '}{r.source === 'VERIFIED_ORDER' ? '已核验订单' : '线下补评'}
            </p>
          </article>
        ))}
      </div>

      {d && feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetching}
          className="mt-4 w-full rounded-pill border border-line py-2.5 text-xs font-semibold text-muted disabled:opacity-50">
          {feed.isFetchingNextPage ? '加载中…' : `加载更多（${all.length}/${d.meta.total}）`}
        </button>
      )}
      <BottomNav />
    </main>
  );
}
