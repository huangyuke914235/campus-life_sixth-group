'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCart } from '@/lib/cart';
import { get, post, endpoints, ApiError } from '@/lib/api';

interface Slot { id: string; startTime: string; endTime: string; remaining: number; bookable: boolean; isClosed: boolean }

function currentMealType(): 'BREAKFAST' | 'LUNCH' | 'DINNER' {
  const h = new Date().getHours();
  if (h < 10) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  return 'DINNER';
}

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, totalCents, clear } = useCart();
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState('');
  const idempotencyKey = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Date.now()));

  const mealType = currentMealType();
  const date = new Date().toISOString().slice(0, 10);
  const stallId = lines[0]?.stallId;

  const slots = useQuery({
    queryKey: ['slots', stallId, date, mealType],
    enabled: !!stallId,
    queryFn: () => get<Slot[]>(endpoints.pickupSlots(stallId!, date, mealType)),
  });

  const total = totalCents();
  const canSubmit = useMemo(() => lines.length > 0 && !!slotId, [lines.length, slotId]);

  const submit = useMutation({
    mutationFn: () => post<{ order: { id: string; number: string } }>(endpoints.orders, {
      stallId, pickupSlotId: slotId, scheduledDate: date, mealType,
      items: lines.map((l) => ({ dishId: l.dishId, quantity: l.quantity })),
      idempotencyKey: idempotencyKey.current,
    }),
    onSuccess: () => { clear(); router.push('/orders'); },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '下单失败，请稍后重试'),
  });

  if (lines.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-md px-5 pt-10 text-center">
        <p className="text-sm font-semibold">清单是空的</p>
        <Link href="/recommend" className="sg-btn-primary mt-5 inline-block text-xs">今天吃什么</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-32 pt-8">
      <Link href="/cart" className="text-xs text-muted">← 返回清单</Link>
      <h1 className="mt-3 text-xl font-bold">预约取餐</h1>
      <p className="mt-1 text-xs text-muted">{mealType === 'BREAKFAST' ? '早餐' : mealType === 'LUNCH' ? '午餐' : '晚餐'} · {date} · {lines[0].stallName}</p>

      <section className="sg-card mt-5 p-4">
        <h2 className="text-sm font-bold">选择取餐时段</h2>
        {slots.isPending && <div className="sg-skeleton mt-3 h-16" />}
        {slots.isError && <p className="mt-3 text-xs text-red-700">时段加载失败，请稍后重试。</p>}
        {slots.data && slots.data.length === 0 && <p className="mt-3 text-xs text-muted">该档口今日暂未配置取餐时段。</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {slots.data?.map((s) => (
            <button key={s.id} type="button" disabled={!s.bookable} onClick={() => setSlotId(s.id)}
              aria-pressed={slotId === s.id}
              className={`sg-chip min-h-[40px] ${slotId === s.id ? 'sg-chip-active' : ''} disabled:cursor-not-allowed disabled:opacity-40`}>
              {s.startTime}–{s.endTime}<span className="ml-1 opacity-70">余 {s.remaining}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">时段容量与截止时间由商户配置，满员或过期不可选；下单时后端会再次校验并扣减库存。</p>
      </section>

      <section className="sg-card mt-4 p-4">
        <h2 className="text-sm font-bold">本单菜品</h2>
        <ul className="mt-3 flex flex-col gap-2 text-xs">
          {lines.map((l) => (
            <li key={l.dishId} className="flex justify-between"><span>{l.name} × {l.quantity}</span><span className="text-muted">¥{((l.priceCents * l.quantity) / 100).toFixed(2)}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-bold">
          <span>合计</span><span className="text-orange-deep">¥{(total / 100).toFixed(2)}</span>
        </div>
        <p className="mt-2 rounded-lg bg-beige p-2 text-[11px] leading-5 text-muted dark:bg-[#2F362D]">
          支付方式：<strong>到店付款</strong>，取餐时在档口结算。
        </p>
      </section>

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 px-5 py-3 backdrop-blur dark:bg-[#262B24]">
        <div className="mx-auto max-w-md">
          <button type="button" disabled={!canSubmit || submit.isPending} onClick={() => { setError(''); submit.mutate(); }}
            className="sg-btn-primary w-full disabled:opacity-50">
            {submit.isPending ? '提交中…' : slotId ? `确认下单 · ¥${(total / 100).toFixed(2)}` : '请选择取餐时段'}
          </button>
        </div>
      </div>
    </main>
  );
}
