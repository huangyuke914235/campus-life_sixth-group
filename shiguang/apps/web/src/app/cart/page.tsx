'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarDays, Minus, Plus, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { useCart, useCartHydrated } from '@/lib/cart';
import { resolveDishImage } from '@/lib/dish-image';
import { MEAL_LABELS } from '@/lib/meals';
import { formatOrderMoney } from '@/lib/order-display';

export default function CartPage() {
  const { lines, supply, setQuantity, remove, clear, totalCents } = useCart();
  const hydrated = useCartHydrated();
  const quantity = lines.reduce((count, line) => count + line.quantity, 0);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-40 pt-6 sm:px-8 sm:pt-10 lg:pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/discover" className="inline-flex min-h-10 items-center gap-2 text-muted hover:text-orange-deep">
          <ArrowLeft size={16} aria-hidden /> 继续选菜
        </Link>
        <Link href="/orders" className="inline-flex min-h-10 items-center gap-2 font-semibold hover:text-orange-deep">
          我的订单 <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">购物车</h1>
        {hydrated && quantity > 0 && <p className="mt-1 text-sm text-muted">已选 {quantity} 份菜品</p>}
      </header>

      {!hydrated ? (
        <div className="sg-skeleton h-36" role="status" aria-label="正在读取购物车" />
      ) : lines.length === 0 ? (
        <section className="sg-card flex flex-col items-center px-6 py-12 text-center">
          <ShoppingBag size={30} strokeWidth={1.6} className="text-orange-deep" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">购物车是空的</h2>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/discover" className="sg-btn-primary">浏览菜品</Link>
            <Link href="/recommend" className="rounded-pill border border-line px-5 py-3 text-sm font-semibold">帮我选菜</Link>
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <section aria-label="购物车菜品">
            <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
              <div className="min-w-0">
                <h2 className="flex items-start gap-2 font-semibold">
                  <Store size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span className="break-words">{lines[0].stallName}</span>
                </h2>
                {supply && <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <CalendarDays size={14} className="shrink-0" aria-hidden /> {supply.date} · {MEAL_LABELS[supply.mealType]}
                </p>}
              </div>
              <button type="button" onClick={clear} className="min-h-10 shrink-0 rounded-lg px-2 text-xs text-muted hover:bg-beige dark:hover:bg-[#2F362D]">清空</button>
            </div>

            <ul className="mt-3 space-y-3">
              {lines.map((line) => (
                <li key={line.dishId} className="sg-card grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-4 sm:p-4">
                  <div className="row-span-2 aspect-square self-start overflow-hidden rounded-xl bg-beige dark:bg-[#2F362D]">
                    <img src={resolveDishImage(line.name, line.imageUrl)} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-1">
                    <div className="min-w-0 py-0.5">
                      <Link href={`/dishes/${line.dishId}`} className="break-words text-sm font-semibold leading-snug hover:text-orange-deep">{line.name}</Link>
                      <p className="mt-1 text-xs tabular-nums text-muted">单价 {formatOrderMoney(line.priceCents)}</p>
                    </div>
                    <button type="button" aria-label={`删除 ${line.name}`} onClick={() => remove(line.dishId)}
                      className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-beige hover:text-orange-deep dark:hover:bg-[#2F362D]">
                      <Trash2 size={17} aria-hidden />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex items-center rounded-full border border-line">
                      <button type="button" aria-label={`减少 ${line.name}`} onClick={() => setQuantity(line.dishId, line.quantity - 1)} disabled={line.quantity <= 1}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-beige disabled:text-muted/50 dark:hover:bg-[#2F362D]"><Minus size={16} aria-hidden /></button>
                      <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                      <button type="button" aria-label={`增加 ${line.name}`} onClick={() => setQuantity(line.dishId, line.quantity + 1)} disabled={line.quantity >= 99}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-beige disabled:text-muted/50 dark:hover:bg-[#2F362D]"><Plus size={16} aria-hidden /></button>
                    </div>
                    <span className="whitespace-nowrap text-sm font-bold tabular-nums">{formatOrderMoney(line.priceCents * line.quantity)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside aria-label="购物车结算" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--surface)] px-4 pt-3 [padding-bottom:calc(.75rem+env(safe-area-inset-bottom))] sm:px-8 lg:sticky lg:top-8 lg:rounded-card lg:border lg:p-5">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:flex-col lg:items-stretch">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
                <span className="text-xs text-muted lg:text-sm">合计 · {quantity} 份</span>
                <strong aria-live="polite" className="text-xl tabular-nums text-orange-deep">{formatOrderMoney(totalCents())}</strong>
              </div>
              <Link href="/checkout" className="sg-btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap lg:mt-3">
                去结算 · 选时段 <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
