'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, UtensilsCrossed } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { useCart } from '@/lib/cart';
import { post, ApiError } from '@/lib/api';
import { MEAL_LABELS, type SupplyContext } from '@/lib/meals';
import { campusMealType, type MealType } from '@shiguang/shared';

const STYLES = [
  { k: 'BALANCED', t: '随便吃点', d: '不挑，均衡就好' },
  { k: 'LIGHT', t: '清淡一点', d: '少油少辣' },
  { k: 'SPICY', t: '想吃辣', d: '辣度两星以上' },
  { k: 'HEARTY', t: '要管饱', d: '份量优先' },
  { k: 'HIGH_PROTEIN', t: '高蛋白', d: '增肌 / 健身' },
  { k: 'HIGH_FIBER', t: '高纤维', d: '多蔬菜粗粮' },
  { k: 'LOW_SODIUM', t: '低盐', d: '咸度两星以下' },
  { k: 'LOW_CALORIE', t: '低卡', d: '少油轻负担' },
];
const BUDGETS = [1500, 2000, 2500, 3000];

interface Slot {
  role: string; roles: string[]; dishId: string; name: string; priceCents: number;
  canteenId: string; stallId: string; stallName: string; score: number; reason: string;
}
interface SetMeal extends SupplyContext {
  style: string; styleLabel: string; summary: string; totalCents: number;
  budgetCents: number; overBudget: boolean; missingRoles: string[];
  nutrition: { energyKcal: number; proteinG: number; fatG: number; carbG: number; allEstimated: boolean } | null;
  slots: Slot[]; rejectedCount: number; disclaimer: string;
}
const ROLE: Record<string, string> = { STAPLE: '主食', PROTEIN: '蛋白', VEGETABLE: '蔬菜', SOUP: '汤饮' };

export default function SetMealPage() {
  const cart = useCart();
  const [style, setStyle] = useState('BALANCED');
  const [mealType, setMealType] = useState(() => campusMealType(new Date()));
  const [budget, setBudget] = useState(2500);
  const [toast, setToast] = useState('');

  const compose = useMutation({
    mutationFn: () => post<SetMeal>('/recommendations/set-meal', { style, budgetCents: budget, mealType }),
  });

  const data = compose.data;

  // 按档口分组：一个订单只能含同一档口，跨档口需分开加
  const byStall = (() => {
    const map = new Map<string, Slot[]>();
    (data?.slots ?? []).forEach((s) => {
      const arr = map.get(s.stallId) ?? [];
      arr.push(s);
      map.set(s.stallId, arr);
    });
    return [...map.entries()];
  })();

  const addGroup = (slots: Slot[]) => {
    if (!data) return;
    let okCount = 0;
    let lastMsg = '';
    for (const s of slots) {
      const r = cart.add({
        dishId: s.dishId, name: s.name, priceCents: s.priceCents,
        stallId: s.stallId, stallName: s.stallName || '档口', canteenId: s.canteenId,
      }, 1, { date: data.date, mealType: data.mealType });
      if (r.ok) okCount += 1; else lastMsg = r.message;
    }
    setToast(okCount > 0 ? `已加入 ${okCount} 道菜` : lastMsg || '加入失败');
  };

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 pb-28 pt-8">
      <Link href="/dashboard" className="text-xs text-muted">← 首页</Link>
      <header className="mt-3">
        <h1 className="text-xl font-bold">一键搭配</h1>
        <p className="mt-1 text-xs text-muted">不想挑？给我一个风格和预算，直接配一份完整的一餐</p>
      </header>

      <label className="mt-4 flex items-center gap-2 text-xs text-muted">搭配餐次
        <select className="sg-input w-auto" value={mealType} disabled={compose.isPending} onChange={(event) => {
          setMealType(event.target.value as MealType);
          compose.reset();
        }}>
          {Object.entries(MEAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      <section className="mt-4 flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <button key={s.k} type="button" onClick={() => setStyle(s.k)} aria-pressed={style === s.k}
            className={`sg-chip ${style === s.k ? 'sg-chip-active' : ''}`}>{s.t}</button>
        ))}
      </section>
      <p className="mt-1 text-[11px] text-muted">{STYLES.find((s) => s.k === style)?.d}</p>

      <section className="mt-4">
        <p className="text-xs font-semibold">整餐预算</p>
        <div className="mt-2 flex gap-2">
          {BUDGETS.map((b) => (
            <button key={b} type="button" onClick={() => setBudget(b)} aria-pressed={budget === b}
              className={`sg-chip ${budget === b ? 'sg-chip-active' : ''}`}>¥{b / 100}</button>
          ))}
        </div>
      </section>

      <button type="button" onClick={() => { setToast(''); compose.mutate(); }} disabled={compose.isPending}
        className="sg-btn-primary mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-60">
        <Sparkles size={16} aria-hidden /> {compose.isPending ? '正在搭配…' : '配一份'}
      </button>

      {compose.isPending && <div className="mt-4 flex flex-col gap-2">{[1, 2, 3].map((i) => <div key={i} className="sg-skeleton h-16" />)}</div>}
      {compose.isError && (
        <p role="alert" className="sg-card mt-4 p-4 text-xs text-red-700">
          {compose.error instanceof ApiError ? compose.error.message : '搭配失败，请稍后重试'}
        </p>
      )}

      {data && data.slots.length === 0 && (
        <p className="sg-card mt-4 p-5 text-center text-xs text-muted">当前条件下没有可搭配的菜品（{data.rejectedCount} 道被售罄/忌口排除），试试放宽预算或换风格。</p>
      )}

      {data && data.slots.length > 0 && (
        <>
          <section className="sg-card mt-4 bg-orange-light p-4">
            <p className="text-xs font-semibold text-orange-deep">{data.styleLabel} · 合计 ¥{(data.totalCents / 100).toFixed(1)}</p>
            <p className="mt-1 text-sm leading-6">{data.summary}</p>
            {data.overBudget && (
              <p className="mt-1 text-[11px] text-red-700">已超出预算 ¥{((data.totalCents - data.budgetCents) / 100).toFixed(1)}，可换更便宜的档口或调高预算。</p>
            )}
            {data.missingRoles?.length > 0 && (
              <p className="mt-1 text-[11px] text-orange-deep">
                预算内没配到：{data.missingRoles.map((r) => ROLE[r] ?? r).join('、')}，可调高预算或换一个风格。
              </p>
            )}
            {data.nutrition && (
              <p className="mt-2 text-[11px] text-muted">
                估算合计 {data.nutrition.energyKcal} kcal · 蛋白 {data.nutrition.proteinG}g · 脂肪 {data.nutrition.fatG}g · 碳水 {data.nutrition.carbG}g
                {data.nutrition.allEstimated ? '（估算值）' : ''}
              </p>
            )}
          </section>

          <section className="mt-4 flex flex-col gap-3">
            {data.slots.map((s) => (
              <article key={s.dishId} className="sg-card p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] text-orange-deep">{(s.roles ?? [s.role]).map((r) => ROLE[r] ?? r).join(' · ')}</p>
                    <Link href={`/dishes/${s.dishId}`} className="block truncate text-sm font-bold">{s.name}</Link>
                    <p className="mt-0.5 text-[11px] text-muted">{s.stallName}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold">¥{(s.priceCents / 100).toFixed(2)}</p>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">{s.reason}</p>
              </article>
            ))}
          </section>

          <section className="mt-4 flex flex-col gap-2">
            {byStall.length === 1 ? (
              <button type="button" onClick={() => addGroup(byStall[0][1])} className="sg-btn-primary flex items-center justify-center gap-2">
                <UtensilsCrossed size={16} aria-hidden /> 整份加入清单 · ¥{(data.totalCents / 100).toFixed(1)}
              </button>
            ) : (
              <>
                <p className="text-[11px] text-muted">这份搭配跨了 {byStall.length} 个档口，一个订单只能含同一档口，请分别加入下单：</p>
                {byStall.map(([stallId, slots]) => (
                  <button key={stallId} type="button" onClick={() => addGroup(slots)}
                    className="rounded-pill border border-orange px-4 py-2.5 text-xs font-semibold text-orange-deep">
                    加入这组（{slots.length} 道 · ¥{(slots.reduce((s, x) => s + x.priceCents, 0) / 100).toFixed(1)}）
                  </button>
                ))}
              </>
            )}
            <p className="text-[11px] leading-5 text-muted">{data.disclaimer}</p>
          </section>
        </>
      )}

      {toast && <div role="status" className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-white">{toast}</div>}
      <BottomNav />
    </main>
  );
}
