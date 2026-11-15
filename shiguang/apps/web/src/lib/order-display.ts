import { ORDER_STATUS_LABELS, type MealType, type OrderStatus } from '@shiguang/shared';
import { MEAL_LABELS } from './meals';

export function formatOrderMoney(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function orderStatusLabel(status: string) {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? '状态待更新';
}

export function orderStatusColor(status: string) {
  switch (status) {
    case 'READY':
    case 'COMPLETED':
      return 'bg-sage-light text-[#275434] dark:bg-[#263d30] dark:text-[#bce6c6]';
    case 'PENDING':
    case 'CONFIRMED':
    case 'PREPARING':
      return 'bg-[#fff0de] text-[#884012] dark:bg-[#492f22] dark:text-[#ffc395]';
    default:
      return 'bg-beige text-muted dark:bg-[#2F362D]';
  }
}

export function isOpenOrder(status: string) {
  return ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].includes(status);
}

export function pickupSchedule(order: {
  scheduledDate: string;
  mealType: MealType;
  pickupSlot: { startTime: string; endTime: string } | null;
}) {
  const parts = [order.scheduledDate.slice(0, 10), MEAL_LABELS[order.mealType]];
  if (order.pickupSlot) parts.push(`${order.pickupSlot.startTime}–${order.pickupSlot.endTime}`);
  return parts.filter(Boolean).join(' · ');
}
