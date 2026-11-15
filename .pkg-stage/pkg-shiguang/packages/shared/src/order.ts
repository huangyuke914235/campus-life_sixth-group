/**
 * 订单领域纯函数 —— 金额、状态流转、时段容量、取餐码。
 * 后端在数据库事务中调用，前端仅做展示，不允许用前端状态伪造核销。
 */
import { ORDER_TRANSITIONS, type MealType, type OrderStatus } from './domain';

// 营业日与取餐时段均使用中国标准时间 (Asia/Shanghai，UTC+08:00)。
const CAMPUS_OFFSET_MS = 8 * 60 * 60 * 1000;

export function campusDate(now: Date): string {
  return new Date(now.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);
}

export function campusClock(now: Date): string {
  return new Date(now.getTime() + CAMPUS_OFFSET_MS).toISOString().slice(11, 16);
}

export function campusMealType(now: Date): MealType {
  const hour = Number(campusClock(now).slice(0, 2));
  if (hour < 10) return 'BREAKFAST';
  if (hour < 15) return 'LUNCH';
  return 'DINNER';
}

/** Prisma @db.Date 的 UTC 零点表示，仅用于传输日历日期。 */
export function parseCampusDate(date: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return parsed;
}

/** 校园日历日期及 HH:mm 对应的实际时刻。 */
export function campusTime(date: string, time: string): Date | undefined {
  if (!parseCampusDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined;
  return new Date(`${date}T${time}:00+08:00`);
}

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
  if (!Number.isInteger(slot.capacity) || slot.capacity <= 0 || !Number.isInteger(slot.booked) || slot.booked < 0) {
    return { ok: false, reason: 'INVALID_SLOT' };
  }
  if (slot.booked >= slot.capacity) return { ok: false, reason: 'FULL' };
  const now = Date.parse(nowIso);
  const start = campusTime(slot.date, slot.startTime);
  const end = campusTime(slot.date, slot.endTime);
  if (!start || !end || start >= end || !Number.isFinite(now)
    || !Number.isInteger(slot.cutoffMinutes) || slot.cutoffMinutes < 0) {
    return { ok: false, reason: 'INVALID_SLOT' };
  }
  const cutoff = start.getTime() - slot.cutoffMinutes * 60_000;
  if (now > cutoff) return { ok: false, reason: 'PAST_CUTOFF' };
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
  const now = Date.parse(v.now);
  const expiresAt = Date.parse(v.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt) {
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }
  if (v.orderStallId !== v.requestStallId) return { ok: false, reason: 'STALL_MISMATCH' };
  if (!canTransition(v.orderStatus, 'COMPLETED') && v.orderStatus !== 'READY') {
    return { ok: false, reason: 'ORDER_NOT_READY' };
  }
  return { ok: true };
}
