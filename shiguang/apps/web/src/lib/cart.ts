'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { campusDate } from '@shiguang/shared';
import { MEAL_LABELS, type SupplyContext } from './meals';

export interface CartLine {
  dishId: string;
  name: string;
  priceCents: number;
  quantity: number;
  stallId: string;
  stallName: string;
  canteenId: string;
  imageUrl?: string;
}

interface CartState {
  lines: CartLine[];
  supply: SupplyContext | null;
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number, supply?: SupplyContext) => { ok: boolean; message: string };
  remove: (dishId: string) => void;
  setQuantity: (dishId: string, quantity: number) => void;
  updatePrices: (prices: { dishId: string; unitPriceCents: number }[]) => void;
  clear: () => void;
  totalCents: () => number;
}

/**
 * 购物车只做本地暂存，价格与库存以下单时后端校验为准。
 * 一个订单只能含同一档口，跨档口加购会被拒绝并提示分开下单。
 */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      supply: null,
      add: (line, quantity = 1, supply) => {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
          return { ok: false, message: '每道菜可购买 1–99 份' };
        }
        const { lines: existing, supply: existingSupply } = get();
        const otherStall = existing.find((l) => l.stallId !== line.stallId);
        if (otherStall) {
          return { ok: false, message: `清单里有「${otherStall.stallName}」的菜，一个订单只能含同一档口，请分开下单` };
        }
        const today = campusDate(new Date());
        const canMoveToToday = existingSupply && supply && existingSupply.date < today
          && supply.date === today && existingSupply.mealType === supply.mealType;
        if (existingSupply && supply && !canMoveToToday && (existingSupply.date !== supply.date || existingSupply.mealType !== supply.mealType)) {
          return { ok: false, message: `清单属于 ${existingSupply.date} ${MEAL_LABELS[existingSupply.mealType]}，请分开下单` };
        }
        const found = existing.find((l) => l.dishId === line.dishId);
        if (found && found.quantity + quantity > 99) return { ok: false, message: '每道菜最多可购买 99 份' };
        if (!found && existing.length >= 50) return { ok: false, message: '每笔订单最多可选 50 道菜' };
        const lines = found
          ? existing.map((l) => l.dishId === line.dishId ? { ...l, quantity: l.quantity + quantity } : l)
          : [...existing, { ...line, quantity }];
        set({ lines, supply: canMoveToToday ? supply : existingSupply ?? supply ?? null });
        return { ok: true, message: '已加入点餐清单' };
      },
      remove: (dishId) => {
        const lines = get().lines.filter((l) => l.dishId !== dishId);
        set({ lines, supply: lines.length ? get().supply : null });
      },
      setQuantity: (dishId, quantity) => {
        if (!Number.isInteger(quantity)) return;
        if (quantity <= 0) {
          get().remove(dishId);
          return;
        }
        set({ lines: get().lines.map((l) => l.dishId === dishId ? { ...l, quantity: Math.min(99, quantity) } : l) });
      },
      updatePrices: (prices) => {
        const byDish = new Map(prices.map((price) => [price.dishId, price.unitPriceCents]));
        set({ lines: get().lines.map((line) => ({ ...line, priceCents: byDish.get(line.dishId) ?? line.priceCents })) });
      },
      clear: () => set({ lines: [], supply: null }),
      totalCents: () => get().lines.reduce((s, l) => s + l.priceCents * l.quantity, 0),
    }),
    { name: 'shiguang-cart' },
  ),
);

export function useCartHydrated() {
  const [hydrated, setHydrated] = useState(false);
  // localStorage is restored synchronously when the store initializes on the client.
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
