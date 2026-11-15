'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => { ok: boolean; message: string };
  remove: (dishId: string) => void;
  setQuantity: (dishId: string, quantity: number) => void;
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
      add: (line, quantity = 1) => {
        const existing = get().lines;
        const otherStall = existing.find((l) => l.stallId !== line.stallId);
        if (otherStall) {
          return { ok: false, message: `清单里有「${otherStall.stallName}」的菜，一个订单只能含同一档口，请分开下单` };
        }
        const found = existing.find((l) => l.dishId === line.dishId);
        if (found) {
          set({ lines: existing.map((l) => l.dishId === line.dishId ? { ...l, quantity: Math.min(99, l.quantity + quantity) } : l) });
        } else {
          set({ lines: [...existing, { ...line, quantity }] });
        }
        return { ok: true, message: '已加入点餐清单' };
      },
      remove: (dishId) => set({ lines: get().lines.filter((l) => l.dishId !== dishId) }),
      setQuantity: (dishId, quantity) => set({
        lines: quantity <= 0
          ? get().lines.filter((l) => l.dishId !== dishId)
          : get().lines.map((l) => l.dishId === dishId ? { ...l, quantity: Math.min(99, quantity) } : l),
      }),
      clear: () => set({ lines: [] }),
      totalCents: () => get().lines.reduce((s, l) => s + l.priceCents * l.quantity, 0),
    }),
    { name: 'shiguang-cart' },
  ),
);
