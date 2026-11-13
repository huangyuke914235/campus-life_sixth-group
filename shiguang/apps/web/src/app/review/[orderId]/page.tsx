'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { StarRating } from '@/components/StarRating';
import { FeelingTags } from '@/components/FeelingTags';
import { get, post, endpoints, ApiError } from '@/lib/api';
import { RECO_DEFAULTS } from '@shiguang/shared';

interface OrderItem { id: string; dishId: string; dishName: string; quantity: number }
interface OrderDetail { id: string; number: string; status: string; items: OrderItem[] }
interface ReviewResult { message: string; algorithmNote: string; reviewId: string }

export default function ReviewPage({ params }: { params: { orderId: string } }) {
  const [dishIndex, setDishIndex] = useState(0);
  const [rating, setRating] = useState(0);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<ReviewResult | null>(null);

  const order = useQuery({ queryKey: ['order', params.orderId], queryFn: () => get<OrderDetail>(endpoints.order(params.orderId)) });
  const item = order.data?.items[dishIndex];

  const submit = useMutation({
    mutationFn: () => post<ReviewResult>(endpoints.createReview, {
      dishId: item!.dishId, orderItemId: item!.id, rating,
      feelings, comment: comment.trim() || undefined,
    }),
    onSuccess: (data) => setResult(data),
  });

  const canSubmit = !!item && rating >= 1 && !submit.isPending;
  const errorText = submit.error instanceof ApiError ? submit.error.message : (submit.error ? '提交失败，请稍后重试' : '');

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-12 pt-8">
      <header className="flex items-center justify-between">
        <Link href="/orders" className="text-sm text-muted">← 订单</Link>
        <h1 className="text-base font-bold">评价这一餐</h1>
        <span className="text-xs text-muted">{order.data?.items.length ? `${dishIndex + 1}/${order.data.items.length}` : ''}</span>
      </header>

      {order.isPending && <div className="sg-skeleton mt-6 h-16" />}
      {order.isError && <div role="alert" className="sg-card mt-6 p-4 text-xs text-red-700">订单加载失败，请返回重试。</div>}

      {order.data && item && (
        <>
          <div className="sg-card mt-5 flex items-center justify-between p-3">
            <div><p className="text-sm font-bold">{item.dishName}</p><p className="text-[11px] text-muted">订单 {order.data.number}</p></div>
            {order.data.items.length > 1 && (
              <select aria-label="选择要评价的菜品" value={dishIndex} onChange={(e) => { setDishIndex(Number(e.target.value)); setResult(null); }}
                className="sg-input w-auto py-1.5 text-xs">
                {order.data.items.map((x, i) => <option key={x.id} value={i}>{x.dishName}</option>)}
              </select>
            )}
          </div>

          {!result ? (
            <div className="mt-4 flex flex-col gap-5">
              <section className="sg-card p-4">
                <h2 className="text-sm font-bold">这一餐怎么样？</h2>
                <div className="mt-3"><StarRating value={rating} onChange={setRating} /></div>
              </section>

              <section className="sg-card p-4">
                <h2 className="mb-3 text-sm font-bold">点几个标签就好（可跳过）</h2>
                <FeelingTags value={feelings} onChange={setFeelings} />
              </section>

              <section className="sg-card p-4">
                <label htmlFor="comment" className="text-sm font-bold">还有什么想说的？一句话就好。</label>
                <textarea id="comment" rows={2} maxLength={RECO_DEFAULTS.maxCommentLength}
                  value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="选填，最多 120 字" className="sg-input mt-2 resize-none" />
                <p className="mt-1 text-right text-[11px] text-muted">{comment.length} / {RECO_DEFAULTS.maxCommentLength}</p>
              </section>

              {errorText && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{errorText}</p>}
              <button type="button" disabled={!canSubmit} onClick={() => submit.mutate()}
                className="sg-btn-primary w-full disabled:opacity-50">
                {submit.isPending ? '提交中…' : '提交评价 · 约 10 秒'}
              </button>
              <p className="text-center text-[11px] text-muted">可以只打星，不写评价；提交后仍可修改。</p>
            </div>
          ) : (
            <section className="sg-card mt-5 bg-sage-light p-5 text-center">
              <p className="text-base font-bold text-sage-deep">{result.message}</p>
              <p className="mt-2 text-xs leading-5 text-sage-deep">{result.algorithmNote}</p>
              <div className="mt-5 flex gap-2">
                <Link href="/recommend" className="sg-btn-primary flex-1 text-center text-xs">看看下次推荐什么</Link>
                <Link href="/orders" className="rounded-pill border border-line px-4 py-3 text-xs">返回订单</Link>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
