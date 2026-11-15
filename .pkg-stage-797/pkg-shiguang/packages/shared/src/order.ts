/**
 * 订单领域纯函数 —— 金额、状态流转、时段容量、取餐码。
 * 后端在数据库事务中调用，前端仅做展示，不允许用前端状态伪造核销。
 */
import { ORDER_TRANSITIONS, type OrderStatus } from './domain';

export interface CartLine {
  dishId: string;
  dishName: string;
  unitPriceCents: number; // 成交价快照
  quantity: number;
}

export interface OrderItemSnapshot extends CartLine {
  subtotalCents: number;
}

/** 单价为「分」的整数，杜绝浮点误差；任何非法输入直接抛错。 */
export function calculateOrderTotal(lines: CartLine[]): { items: OrderItemSnapshot[]; totalCents: number } {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('EMPTY_CART');
  }
  const items = lines.map((line) => {
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new Error('INVALID_UNIT_PRICE');
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > 99) {
      throw new Error('INVALID_QUANTITY');
    }
    return { ...line, subtotalCents: line.unitPriceCents * line.quantity };
  });
  const seen = new Set<string>();
  items.forEach((i) => {
    if (seen.has(i.dishId)) throw new Error('DUPLICATE_DISH_LINE');
    seen.add(i.dishId);
  });
  const totalCents = items.reduce((sum, i) => sum + i.subtotalCents, 0);
  if (totalCents > 100_000_000) throw new Error('TOTAL_OVERFLOW');
  return { items, totalCents };
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`ILLEGAL_ORDER_TRANSITION:${from}->${to}`);
  }
}

/** 只有这些状态允许占用库存；取消/过期会恢复库存。 */
export function stockHoldingStatuses(status: OrderStatus): boolean {
  return ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(status);
}

export interface SlotView {
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
  date: string;        // YYYY-MM-DD
  capacity: number;
  booked: number;
  cutoffMinutes: number;
  isClosed: boolean;
}

export type SlotRejectReason = 'CLOSED' | 'FULL' | 'PAST_CUTOFF' | 'INVALID_SLOT';

export function checkSlotBookable(slot: SlotView, nowIso: string): { ok: boolean; reason?: SlotRejectReason } {
  if (slot.isClosed) return { ok: false, reason: 'CLOSED' };
  if (slot.booked >= slot.capacity) return { ok: false, reason: 'FULL' };
  const now = new Date(nowIso);
  const [h, m] = slot.startTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { ok: false, reason: 'INVALID_SLOT' };
  const cutoff = new Date(`${slot.date}T00:00:00`);
  cutoff.setHours(h, m - slot.cutoffMinutes, 0, 0);
  if (now.getTime() > cutoff.getTime()) return { ok: false, reason: 'PAST_CUTOFF' };
  return { ok: true };
}

/** 6 位数字取餐码。生产环境应由加密安全随机源生成，此处可注入 rng 便于测试。 */
export function generatePickupCode(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += Math.floor(rng() * 10).toString();
  return out;
}

export interface PickupValidation {
  tokenStatus: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
  orderStatus: OrderStatus;
  expiresAt: string;
  orderStallId: string;
  requestStallId: string;
  now: string;
}

/** 核销校验：状态、有效期、所属档口、防重放。改前端状态无法绕过。 */
export function validatePickup(v: PickupValidation): { ok: boolean; reason?: string } {
  if (v.tokenStatus !== 'ACTIVE') return { ok: false, reason: 'TOKEN_NOT_ACTIVE' };
  if (new Date(v.now).getTime() > new Date(v.expiresAt).getTime()) {
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }
  if (v.orderStallId !== v.requestStallId) return { ok: false, reason: 'STALL_MISMATCH' };
  if (!canTransition(v.orderStatus, 'COMPLETED') && v.orderStatus !== 'READY') {
    return { ok: false, reason: 'ORDER_NOT_READY' };
  }
  return { ok: true };
}
