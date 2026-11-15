'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StarRating } from '@/components/StarRating';
import { FeelingTags } from '@/components/FeelingTags';
import { get, post, endpoints, ApiError } from '@/lib/api';
import { RECO_DEFAULTS } from '@shiguang/shared';

interface OrderItem { id: string; dishId: string; dishName: string; quantity: number }
interface OrderDetail {
  id: string;
  number: string;
  status: string;
  items: OrderItem[];
  reviews: { id: string; dishId: string }[];
}
interface ReviewResult { message: string; algorithmNote: string; reviewId: string }
interface ReviewSubmission {
  dishId: string;
  orderItemId: string;
  rating: number;
  feelings: string[];
  comment?: string;
}

function ReviewOrder({ orderId, requestedDishId }: { orderId: string; requestedDishId: string | null }) {
  const queryClient = useQueryClient();
  const orderKey = ['order', orderId];
  const orderHref = '/orders/' + orderId;
  const [selectedDishId, setSelectedDishId] = useState(requestedDishId);
  const [rating, setRating] = useState(0);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ review: ReviewResult; dishId: string } | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState<string[]>([]);

  const order = useQuery({
    queryKey: orderKey,
    queryFn: ({ signal }) => get<OrderDetail>(endpoints.order(orderId), signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const submit = useMutation({
    mutationFn: (submission: ReviewSubmission) => post<ReviewResult>(endpoints.createReview, submission),
    onSuccess: (review, selected) => {
      setResult({ review, dishId: selected.dishId });
      queryClient.setQueryData<OrderDetail>(orderKey, (current) => {
        if (!current || current.reviews?.some((entry) => entry.dishId === selected.dishId)) return current;
        return { ...current, reviews: [...(current.reviews ?? []), { id: review.reviewId, dishId: selected.dishId }] };
      });
      void queryClient.invalidateQueries({ queryKey: orderKey });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error, submission) => {
      if (isDuplicateReview(error)) {
        setAlreadyReviewed((current) => [...current, submission.dishId]);
        void queryClient.invalidateQueries({ queryKey: orderKey });
      }
    },
  });

  const waitingForCurrentSession = order.isFetching && !order.isFetchedAfterMount;
  const detail = waitingForCurrentSession ? undefined : order.data;
  const completed = detail?.status === 'COMPLETED';
  const unreviewed = completed ? detail.items.filter((item) =>
    item.dishId !== result?.dishId && !alreadyReviewed.includes(item.dishId)
    && !detail.reviews?.some((review) => review.dishId === item.dishId),
  ) : [];
  const nextItem = unreviewed[0];
  const selectedItem = detail?.items.find((item) => item.dishId === selectedDishId);
  const item = unreviewed.find((dish) => dish.dishId === selectedDishId);
  const firstDishId = nextItem?.dishId;
  const choosingInitialDish = selectedDishId === null && firstDishId !== undefined;

  useEffect(() => {
    if (order.isSuccess && firstDishId) setSelectedDishId((current) => current ?? firstDishId);
  }, [order.isSuccess, firstDishId]);

  function selectDish(dishId: string) {
    setSelectedDishId(dishId);
    setRating(0);
    setFeelings([]);
    setComment('');
    setResult(null);
    submit.reset();
  }

  const errorText = submit.error instanceof ApiError ? submit.error.message : (submit.error ? '提交失败，请稍后重试' : '');

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-12 pt-8">
      <header className="flex items-center justify-between gap-2">
        <Link href={orderHref} className="shrink-0 text-sm text-muted">← 订单</Link>
        <h1 className="text-base font-bold">评价这一餐</h1>
        <span className="shrink-0 text-xs text-muted">{completed && unreviewed.length > 0 ? '待评价 ' + unreviewed.length + ' 道' : ''}</span>
      </header>

      {(order.isPending || waitingForCurrentSession) && <div className="sg-skeleton mt-6 h-16" />}
      {order.isError && (
        <div role="alert" className="sg-card mt-6 p-4 text-xs text-red-700">
          订单加载失败。
          <button type="button" onClick={() => void order.refetch()} className="ml-2 font-semibold underline">重试</button>
        </div>
      )}

      {result ? (
        <section role="status" className="sg-card mt-5 bg-sage-light p-5 text-center">
          <p className="text-base font-bold text-sage-deep">{result.review.message}</p>
          <p className="mt-2 text-xs leading-5 text-sage-deep">{result.review.algorithmNote}</p>
          {nextItem && (
            <button type="button" onClick={() => selectDish(nextItem.dishId)} className="sg-btn-primary mt-5 w-full text-xs">
              评价下一道菜
            </button>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/recommend" className="rounded-pill border border-line px-4 py-3 text-xs">看看下次推荐什么</Link>
            <Link href={orderHref} className="rounded-pill border border-line px-4 py-3 text-xs">返回订单</Link>
          </div>
        </section>
      ) : order.isSuccess && !waitingForCurrentSession && !item && !choosingInitialDish ? (
        <section className="sg-card mt-5 p-5 text-center">
          <p className="break-words text-sm font-semibold">
            {!completed ? '取餐完成后即可评价'
              : selectedItem ? `「${selectedItem.dishName}」已评价`
                : selectedDishId ? '找不到要评价的菜品' : '这份订单的菜品都已评价'}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            {nextItem && (
              <button type="button" onClick={() => selectDish(nextItem.dishId)} className="sg-btn-primary text-xs">
                评价其他菜品
              </button>
            )}
            <Link href={orderHref} className="inline-block text-xs font-semibold text-orange-deep">查看订单详情</Link>
          </div>
        </section>
      ) : order.isSuccess && item && (
        <>
          <div className="sg-card mt-5 flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-bold">{item.dishName}</p>
              <p className="break-all text-[11px] text-muted">订单 {order.data.number}</p>
            </div>
            {unreviewed.length > 1 && (
              <select aria-label="选择要评价的菜品" value={item.dishId} onChange={(event) => selectDish(event.target.value)}
                disabled={submit.isPending} className="sg-input min-w-0 max-w-full py-1.5 text-xs sm:w-auto">
                {unreviewed.map((dish) => <option key={dish.id} value={dish.dishId}>{dish.dishName}</option>)}
              </select>
            )}
          </div>

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
                value={comment} onChange={(event) => setComment(event.target.value)}
                placeholder="选填，最多 120 字" className="sg-input mt-2 resize-none" />
              <p className="mt-1 text-right text-[11px] text-muted">{comment.length} / {RECO_DEFAULTS.maxCommentLength}</p>
            </section>

            {errorText && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{errorText}</p>}
            <button type="button" disabled={rating < 1 || submit.isPending}
              onClick={() => submit.mutate({ dishId: item.dishId, orderItemId: item.id, rating, feelings, comment: comment.trim() || undefined })}
              className="sg-btn-primary w-full disabled:opacity-50">
              {submit.isPending ? '提交中…' : '提交评价 · 约 10 秒'}
            </button>
            <p className="text-center text-[11px] text-muted">可以只打星，不写评价；提交后仍可修改。</p>
          </div>
        </>
      )}
    </main>
  );
}

function isDuplicateReview(error: unknown) {
  return error instanceof ApiError && error.code === 10007 && error.status === 409;
}

function ReviewSelection({ orderId }: { orderId: string }) {
  const dishId = useSearchParams().get('dishId');
  return <ReviewOrder key={orderId + ':' + (dishId ?? '')} orderId={orderId} requestedDishId={dishId} />;
}

export default function ReviewPage({ params }: { params: { orderId: string } }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen max-w-md px-5 pt-8"><div className="sg-skeleton h-16" /></main>}>
      <ReviewSelection orderId={params.orderId} />
    </Suspense>
  );
}
