'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StarRating } from '@/components/StarRating';
import { FeelingTags } from '@/components/FeelingTags';
import { get, post, ApiError } from '@/lib/api';
import { RECO_DEFAULTS } from '@shiguang/shared';

interface DishBrief { id: string; name: string; avgRating: number; ratingCount: number }
interface Result { message: string; algorithmNote: string; source: string }

export default function DishReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<Result | null>(null);

  const dish = useQuery({ queryKey: ['dish', id], queryFn: () => get<DishBrief>(`/dishes/${id}`) });
  const submit = useMutation({
    mutationFn: () => post<Result>('/reviews', {
      dishId: id, rating, feelings, comment: comment.trim() || undefined,
    }),
    onSuccess: (r) => setDone(r),
  });

  const err = submit.error instanceof ApiError ? submit.error.message : (submit.error ? '提交失败，请稍后重试' : '');

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-12 pt-8">
      <Link href={`/dishes/${id}`} className="text-xs text-muted">← 菜品详情</Link>
      <header className="mt-3">
        <h1 className="text-xl font-bold">写个评价</h1>
        <p className="mt-1 text-xs text-muted">{dish.data?.name ?? '菜品'} · 线下补评不计入已核验评分，24 小时内最多 3 条</p>
      </header>

      {!done ? (
        <div className="mt-4 flex flex-col gap-4">
          <section className="sg-card p-4">
            <h2 className="text-sm font-bold">整体评分</h2>
            <div className="mt-2"><StarRating value={rating} onChange={setRating} /></div>
          </section>

          <section className="sg-card p-4">
            <h2 className="mb-3 text-sm font-bold">具体感受（可跳过）</h2>
            <FeelingTags value={feelings} onChange={setFeelings} />
          </section>

          <section className="sg-card p-4">
            <label htmlFor="cmt" className="text-sm font-bold">一句话点评</label>
            <textarea id="cmt" rows={3} maxLength={RECO_DEFAULTS.maxCommentLength} value={comment}
              onChange={(e) => setComment(e.target.value)} placeholder="选填，最多 120 字"
              className="sg-input mt-2 resize-none" />
            <p className="mt-1 text-right text-[11px] text-muted">{comment.length} / {RECO_DEFAULTS.maxCommentLength}</p>
          </section>

          {err && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

          <button type="button" disabled={rating < 1 || submit.isPending} onClick={() => submit.mutate()}
            className="sg-btn-primary disabled:opacity-50">{submit.isPending ? '提交中…' : '提交评价'}</button>
          <p className="text-center text-[11px] text-muted">主观体感不构成医学判断；提交后可在「我的」里查看。</p>
        </div>
      ) : (
        <section className="sg-card mt-6 bg-sage-light p-5 text-center">
          <p className="text-base font-bold text-sage-deep">{done.message}</p>
          <p className="mt-2 text-xs leading-5 text-sage-deep">{done.algorithmNote}</p>
          <div className="mt-5 flex gap-2">
            <Link href={`/dishes/${id}`} className="sg-btn-primary flex-1 text-center text-xs">返回菜品</Link>
            <button type="button" onClick={() => router.push('/recommend')} className="rounded-pill border border-line px-4 py-3 text-xs">看推荐</button>
          </div>
        </section>
      )}
    </main>
  );
}
