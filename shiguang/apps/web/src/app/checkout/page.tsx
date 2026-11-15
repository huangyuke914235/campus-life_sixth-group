'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, CircleAlert, Clock, ReceiptText, Store } from 'lucide-react';
import { useCart, useCartHydrated, type CartLine } from '@/lib/cart';
import { get, post, endpoints, ApiError } from '@/lib/api';
import { MEAL_LABELS, type SupplyContext } from '@/lib/meals';
import { formatOrderMoney } from '@/lib/order-display';
import { readCheckoutAttempt, removeCheckoutAttempt, saveCheckoutAttempt, type CheckoutAttempt } from '@/lib/checkout-attempt';
import { shoppingLoginHref } from '@/lib/shopping-return';
import { campusDate, campusMealType } from '@shiguang/shared';

interface Slot { id: string; startTime: string; endTime: string; remaining: number; bookable: boolean; isClosed: boolean }
interface PriceQuote { dishId: string; unitPriceCents: number }

const orderLines = (lines: CartLine[]) => lines.map(({ dishId, quantity, priceCents }) => ({
  dishId, quantity, expectedUnitPriceCents: priceCents,
})).sort((a, b) => a.dishId.localeCompare(b.dishId));

const cartSnapshot = (lines: CartLine[], supply: SupplyContext | null) =>
  JSON.stringify([lines[0]?.stallId, orderLines(lines), supply?.date, supply?.mealType]);

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
  const qc = useQueryClient();
  const hydrated = useCartHydrated();
  const { lines, supply, totalCents, updatePrices } = useCart();
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<SupplyContext | null>(null);
  const [quote, setQuote] = useState<PriceQuote[]>([]);
  const [pending, setPending] = useState<CheckoutAttempt | null>(null);
  const [restoredFor, setRestoredFor] = useState<string>();
  const submitting = useRef(false);
  const session = useQuery({
    queryKey: ['checkout-session'],
    queryFn: ({ signal }) => get<{ id: string; role: string }>(endpoints.me, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  const ownerId = session.isSuccess && session.data.role !== 'MERCHANT' ? session.data.id : undefined;
  const recovery = pending?.ownerId === ownerId ? pending : null;

  useEffect(() => {
    if (!ownerId || session.isFetching || restoredFor === ownerId) return;
    setPending(readCheckoutAttempt(ownerId));
    setRestoredFor(ownerId);
  }, [ownerId, restoredFor, session.isFetching]);

  const now = new Date();
  const today = campusDate(now);
  const context = selection ?? {
    date: supply && supply.date >= today ? supply.date : today,
    mealType: supply?.mealType ?? campusMealType(now),
  };
  const { date, mealType } = context;
  const stallId = lines[0]?.stallId;

  const slots = useQuery({
    queryKey: ['slots', stallId, date, mealType],
    enabled: hydrated && !!stallId,
    queryFn: ({ signal }) => get<Slot[]>(endpoints.pickupSlots(stallId!, date, mealType), signal),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const total = totalCents();
  const selectedSlot = slots.data?.find((slot) => slot.id === slotId && slot.bookable);
  const canSubmit = !!ownerId && restoredFor === ownerId && !session.isFetching
    && !!selectedSlot && !slots.isError && quote.length === 0;

  const submit = useMutation({
    mutationFn: (attempt: CheckoutAttempt) => post<{ order: { id: string; number: string } }>(endpoints.orders, attempt.body),
    onSuccess: ({ order }, attempt) => {
      removeCheckoutAttempt(attempt);
      const cart = useCart.getState();
      if (cartSnapshot(cart.lines, cart.supply) === attempt.cartSnapshot) cart.clear();
      void qc.invalidateQueries({ queryKey: ['orders'] });
      router.replace('/orders/' + order.id);
    },
    onError: (e: unknown, attempt) => {
      setError(e instanceof ApiError ? e.message : '下单失败，请稍后重试');
      // A transport failure or a proxy error may happen after the transaction commits.
      if (!(e instanceof ApiError) || e.code <= 0 || e.status < 400 || (e.status >= 500 && e.code !== 10016)
        || [401, 403, 408, 429].includes(e.status)) return;
      removeCheckoutAttempt(attempt);
      setPending(null);
      const prices = readPriceQuote(e);
      const cart = useCart.getState();
      if (prices.length > 0 && cartSnapshot(cart.lines, cart.supply) === attempt.cartSnapshot
        && cart.lines.every((line) => prices.some((price) => price.dishId === line.dishId))) {
        setSelection({ date: attempt.body.scheduledDate, mealType: attempt.body.mealType });
        setSlotId(attempt.body.pickupSlotId);
        setQuote(prices);
      }
      if (e.code === 10009 || e.code === 10010) {
        setSlotId('');
        void slots.refetch();
      }
    },
    onSettled: () => { submitting.current = false; },
  });

  function submitAttempt(attempt: CheckoutAttempt) {
    if (submitting.current) return;
    submitting.current = true;
    setError('');
    saveCheckoutAttempt(attempt);
    setPending(attempt);
    submit.mutate(attempt);
  }

  function startCheckout() {
    if (!ownerId || !stallId || !selectedSlot || !canSubmit || recovery) return;
    const key = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('-');
    submitAttempt({
      ownerId,
      cartSnapshot: cartSnapshot(lines, supply),
      slotLabel: selectedSlot.startTime + '–' + selectedSlot.endTime,
      body: {
        stallId, pickupSlotId: selectedSlot.id, scheduledDate: date, mealType,
        items: orderLines(lines), idempotencyKey: key, expectedUserId: ownerId,
      },
    });
  }

  function changeContext(next: SupplyContext) {
    setSelection(next);
    setSlotId('');
    setQuote([]);
    setError('');
  }

  if (submit.isSuccess) {
    return <main className="mx-auto max-w-5xl px-4 pt-8 sm:px-8">
      <p role="status" className="sg-card p-5 font-medium">预约已提交，正在打开订单详情。</p>
    </main>;
  }

  if (!hydrated) {
    return <main className="mx-auto max-w-5xl px-4 pt-8 sm:px-8">
      <div className="sg-skeleton h-40" role="status" aria-label="正在读取购物车" />
    </main>;
  }

  if (recovery) {
    return <main className="mx-auto min-h-screen max-w-lg px-4 pt-8 sm:px-8">
      <section className="sg-card p-5">
        <h1 className="text-xl font-bold">{submit.isPending ? '订单提交中' : '上一笔预约待确认'}</h1>
        <p className="mt-2 text-sm text-muted">{recovery.body.scheduledDate} · {MEAL_LABELS[recovery.body.mealType]} · {recovery.slotLabel}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-200">{error}</p>}
        {!submit.isPending && <>
          <p className="mt-3 text-sm text-muted">重试会继续使用原预约请求。如果订单已创建，将直接打开该笔订单。</p>
          <button type="button" disabled={session.isFetching} onClick={() => submitAttempt(recovery)} className="sg-btn-primary mt-4 disabled:opacity-50">重试原预约</button>
          <Link href="/orders" className="ml-3 text-sm font-semibold text-orange-deep">查看我的订单</Link>
          {submit.error instanceof ApiError && [401, 403].includes(submit.error.status) && (
            <Link href={shoppingLoginHref('/checkout')} className="mt-3 block text-sm font-semibold text-orange-deep">重新登录后继续</Link>
          )}
        </>}
      </section>
    </main>;
  }

  if (lines.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-md px-5 pt-10 text-center">
        <h1 className="text-lg font-semibold">购物车是空的</h1>
        <Link href="/discover" className="sg-btn-primary mt-5 inline-block">去选菜</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-40 pt-6 sm:px-8 sm:pt-10 lg:pb-16">
      <Link href="/cart" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted hover:text-orange-deep">
        <ArrowLeft size={16} aria-hidden /> 返回购物车
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">预约取餐</h1>
        <p className="mt-2 flex items-start gap-2 break-words text-sm text-muted">
          <Store size={16} className="mt-0.5 shrink-0" aria-hidden /> {lines[0].stallName}
        </p>
      </header>

      {session.isError && <div role="alert" className="sg-card mb-4 p-4 text-sm">
        <p>{session.error.message}</p>
        {session.error instanceof ApiError && session.error.status === 401
          ? <Link href={shoppingLoginHref('/checkout')} className="mt-2 inline-block font-semibold text-orange-deep">登录后继续结算</Link>
          : <button type="button" onClick={() => void session.refetch()} className="mt-2 font-semibold text-orange-deep">重新验证登录状态</button>}
      </div>}
      {session.data?.role === 'MERCHANT' && <p role="alert" className="sg-card mb-4 p-4 text-sm">请使用学生账号预约。</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="sg-card min-w-0 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-bold"><CalendarDays size={18} aria-hidden /> 选择取餐时段</h2>
          {!selection && supply && supply.date < today && (
            <p className="mt-2 text-sm text-muted">原预约日期已过，已显示今天的时段。请选择取餐时间。</p>
          )}
          <div className="mt-4 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2 sm:gap-3">
            <label className="min-w-0 text-sm text-muted">取餐日期
              <input className="sg-input mt-1 block min-h-11 min-w-0 max-w-full !px-2 sm:!px-4" type="date" min={today} value={date} disabled={submit.isPending}
                onChange={(event) => { if (event.target.value) changeContext({ ...context, date: event.target.value }); }} />
            </label>
            <label className="min-w-0 text-sm text-muted">取餐餐次
              <select className="sg-input mt-1 min-h-11" value={mealType} disabled={submit.isPending}
                onChange={(event) => changeContext({ ...context, mealType: event.target.value as SupplyContext['mealType'] })}>
                {Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {slots.isPending && <div className="sg-skeleton mt-4 h-14" role="status" aria-label="正在加载取餐时段" />}
          {slots.isError && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">时段加载失败。<button type="button" onClick={() => void slots.refetch()} className="ml-2 min-h-11 underline">重试</button></p>}
          {slots.data && slots.data.length === 0 && <p className="mt-4 rounded-xl bg-[var(--surface-soft)] p-3 text-sm text-muted">该档口在所选日期和餐次没有取餐时段。</p>}
          {!!slots.data?.length && slots.data.every((s) => !s.bookable) && <p className="mt-4 rounded-xl bg-[var(--surface-soft)] p-3 text-sm text-muted">当前餐次没有可预约时段，可改选日期或餐次。</p>}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.data?.map((s) => (
              <button key={s.id} type="button" disabled={!s.bookable || submit.isPending} onClick={() => { setSlotId(s.id); setError(''); }}
                aria-pressed={selectedSlot?.id === s.id}
                className={`sg-chip min-h-12 flex-col justify-center text-center tabular-nums ${selectedSlot?.id === s.id ? 'sg-chip-active' : ''} disabled:cursor-not-allowed disabled:opacity-50`}>
                <span className="font-semibold">{s.startTime}–{s.endTime}</span>
                <span>{s.isClosed ? '已关闭' : s.remaining === 0 ? '已约满' : !s.bookable ? '不可预约' : `余 ${s.remaining} 个名额`}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-8">
          <section className="sg-card p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-base font-bold"><ReceiptText size={18} aria-hidden /> 本单菜品</h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {lines.map((l) => (
                <li key={l.dishId} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{l.name} <span className="whitespace-nowrap text-muted">× {l.quantity}</span></span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{formatOrderMoney(l.priceCents * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-bold">
              <span>合计</span><span className="tabular-nums text-orange-deep">{formatOrderMoney(total)}</span>
            </div>
            <p className="mt-2 rounded-lg bg-beige p-2 text-[11px] leading-5 text-muted dark:bg-[#2F362D]">
              支付方式：<strong>到店付款</strong>，取餐时在档口结算。
            </p>
          </section>

          {error && quote.length === 0 && <p role="alert" className="mt-3 flex items-start gap-2 break-words rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>}
          {quote.length > 0 && (
            <section className="sg-card mt-3 p-4 text-xs">
              <h2 className="font-semibold">菜品价格已变动</h2>
              <ul className="mt-2 space-y-1">
                {lines.map((line) => {
                  const price = quote.find((item) => item.dishId === line.dishId)?.unitPriceCents;
                  return price === undefined || price === line.priceCents ? null : (
                    <li key={line.dishId} className="break-words">{line.name} · {formatOrderMoney(line.priceCents)} → {formatOrderMoney(price)}</li>
                  );
                })}
              </ul>
              <button type="button" className="sg-btn-primary mt-3" onClick={() => { updatePrices(quote); setQuote([]); setError(''); }}>
                确认新价格
              </button>
            </section>
          )}

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--surface)] px-4 pt-3 [padding-bottom:calc(.75rem+env(safe-area-inset-bottom))] sm:px-8 lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0">
            <div className="mx-auto max-w-5xl">
              {selectedSlot && <p className="mb-2 flex items-center justify-center gap-2 text-xs text-muted" aria-live="polite">
                <Clock size={14} aria-hidden /> {date} · {MEAL_LABELS[mealType]} · {selectedSlot.startTime}–{selectedSlot.endTime}
              </p>}
              <button type="button" disabled={!canSubmit || submit.isPending} onClick={startCheckout}
                className="sg-btn-primary w-full disabled:opacity-50">
                {submit.isPending ? '提交中…' : quote.length > 0 ? '请先确认新价格' : selectedSlot ? `确认下单 · ${formatOrderMoney(total)}` : '请选择取餐时段'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
