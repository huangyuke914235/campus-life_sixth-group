'use client';

import Link from 'next/link';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { resolveDishImage } from '@/lib/dish-image';
import { MEAL_LABELS } from '@/lib/meals';

export default function CartPage() {
  const { lines, supply, setQuantity, remove, clear, totalCents } = useCart();
  const total = totalCents();

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-32 pt-8">
      <header className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold">点餐清单</h1>
          {supply && <p className="mt-1 text-xs text-muted">{supply.date} · {MEAL_LABELS[supply.mealType]}</p>}
        </div>
        {lines.length > 0 && <button type="button" onClick={clear} className="text-[11px] text-muted">清空</button>}
      </header>

      {lines.length === 0 ? (
        <div className="sg-card mt-6 p-8 text-center">
          <p className="text-sm font-semibold">清单还是空的</p>
          <p className="mt-1 text-xs text-muted">去挑一道菜，或者让食光帮你选。</p>
          <Link href="/recommend" className="sg-btn-primary mt-5 inline-block text-xs">今天吃什么</Link>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-3">
            {lines.map((l) => (
              <article key={l.dishId} className="sg-card flex items-center gap-3 p-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-beige dark:bg-[#2F362D]">
                  <img src={resolveDishImage(l.name, l.imageUrl)} alt={l.name} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{l.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{l.stallName} · ¥{(l.priceCents / 100).toFixed(0)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="减少" onClick={() => setQuantity(l.dishId, l.quantity - 1)} className="rounded-full border border-line p-1"><Minus size={12} /></button>
                  <span className="w-6 text-center text-xs font-semibold">{l.quantity}</span>
                  <button type="button" aria-label="增加" onClick={() => setQuantity(l.dishId, l.quantity + 1)} className="rounded-full border border-line p-1"><Plus size={12} /></button>
                </div>
                <button type="button" aria-label="删除" onClick={() => remove(l.dishId)} className="text-muted"><Trash2 size={14} /></button>
              </article>
            ))}
          </div>

          <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 px-5 py-3 backdrop-blur dark:bg-[#262B24]">
            <div className="mx-auto flex max-w-md items-center justify-between gap-4">
              <div><p className="text-[11px] text-muted">合计</p><p className="text-lg font-bold text-orange-deep">¥{(total / 100).toFixed(2)}</p></div>
              <Link href="/checkout" className="sg-btn-primary flex-1 text-center">去结算 · 选时段</Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
