'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCart } from '@/lib/cart';
import { get, post, endpoints, ApiError } from '@/lib/api';
import { MEAL_LABELS, type SupplyContext } from '@/lib/meals';
import { campusDate, campusMealType } from '@shiguang/shared';

interface Slot { id: string; startTime: string; endTime: string; remaining: number; bookable: boolean; isClosed: boolean }
interface PriceQuote { dishId: string; unitPriceCents: number }

function readPriceQuote(error: ApiError): PriceQuote[] {
  if (error.code !== 10015) return [];
  const prices = (error.details as { prices?: unknown } | undefined)?.prices;
  if (!Array.isArray(prices)) return [];
  return prices.filter((entry): entry is PriceQuote =>
    typeof entry?.dishId === 'string' && Number.isInteger(entry.unitPriceCents) && entry.unitPriceCents >= 0,
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, supply, totalCents, updatePrices, clear } = useCart();
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<SupplyContext | null>(null);
  const [quote, setQuote] = useState<PriceQuote[]>([]);
  const attempt = useRef<{ payload: string; key: string }>();

  const now = new Date();
  const today = campusDate(now);
  const context = selection ?? supply ?? { date: today, mealType: campusMealType(now) };
  const { date, mealType } = context;
  const stallId = lines[0]?.stallId;

  const slots = useQuery({
    queryKey: ['slots', stallId, date, mealType],
    enabled: !!stallId,
    queryFn: () => get<Slot[]>(endpoints.pickupSlots(stallId!, date, mealType)),
  });

  const total = totalCents();
  const canSubmit = lines.length > 0 && slots.data?.some((slot) => slot.id === slotId && slot.bookable) && quote.length === 0;

  const submit = useMutation({
    mutationFn: () => {
      const body = {
        stallId, pickupSlotId: slotId, scheduledDate: date, mealType,
        items: lines.map((l) => ({
          dishId: l.dishId, quantity: l.quantity, expectedUnitPriceCents: l.priceCents,
        })).sort((a, b) => a.dishId.localeCompare(b.dishId)),
      };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload) {
        const key = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('-');
        attempt.current = { payload, key };
      }
      return post<{ order: { id: string; number: string } }>(endpoints.orders, {
        ...body, idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: () => { clear(); router.push('/orders'); },
    onError: (e: unknown) => {
      setError(e instanceof ApiError ? e.message : '下单失败，请稍后重试');
      if (!(e instanceof ApiError)) return;
      const prices = readPriceQuote(e);
      if (prices.length > 0 && lines.every((line) => prices.some((price) => price.dishId === line.dishId))) {
        setQuote(prices);
      }
      if (e.code === 10009 || e.code === 10010) {
        setSlotId('');
        void slots.refetch();
      }
    },
  });

  function changeContext(next: SupplyContext) {
    setSelection(next);
    setSlotId('');
    setQuote([]);
    setError('');
  }

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
      <p className="mt-1 text-xs text-muted">{lines[0].stallName}</p>

      <section className="sg-card mt-5 p-4">
        <h2 className="text-sm font-bold">选择取餐时段</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs text-muted">取餐日期
            <input className="sg-input mt-1 w-full min-w-0" type="date" min={today} value={date} disabled={submit.isPending}
              onChange={(event) => { if (event.target.value) changeContext({ ...context, date: event.target.value }); }} />
          </label>
          <label className="min-w-0 text-xs text-muted">取餐餐次
            <select className="sg-input mt-1 w-full" value={mealType} disabled={submit.isPending}
              onChange={(event) => changeContext({ ...context, mealType: event.target.value as SupplyContext['mealType'] })}>
              {Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {slots.isPending && <div className="sg-skeleton mt-3 h-16" />}
        {slots.isError && <p role="alert" className="mt-3 text-xs text-red-700">时段加载失败。<button type="button" onClick={() => void slots.refetch()} className="ml-2 underline">重试</button></p>}
        {slots.data && slots.data.length === 0 && <p className="mt-3 text-xs text-muted">该档口在所选日期和餐次没有取餐时段。</p>}
        {!!slots.data?.length && slots.data.every((s) => !s.bookable) && <p className="mt-3 text-xs text-muted">当前餐次没有可预约时段，可改选日期或餐次。</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {slots.data?.map((s) => (
            <button key={s.id} type="button" disabled={!s.bookable || submit.isPending} onClick={() => { setSlotId(s.id); setError(''); }}
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
      {quote.length > 0 && (
        <section className="sg-card mt-3 p-4 text-xs">
          <h2 className="font-semibold">菜品价格已变动</h2>
          <ul className="mt-2 space-y-1">
            {lines.map((line) => {
              const price = quote.find((item) => item.dishId === line.dishId)?.unitPriceCents;
              return price === undefined || price === line.priceCents ? null : (
                <li key={line.dishId}>{line.name} · ¥{(line.priceCents / 100).toFixed(2)} → ¥{(price / 100).toFixed(2)}</li>
              );
            })}
          </ul>
          <button type="button" className="sg-btn-primary mt-3" onClick={() => { updatePrices(quote); setQuote([]); setError(''); }}>
            确认新价格
          </button>
        </section>
      )}

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
