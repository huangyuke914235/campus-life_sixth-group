import type { Prisma } from '@prisma/client';
import { canTransition } from '@shiguang/shared';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/**
 * 订单先认领终态，再释放名额及尚未用于备餐的库存。
 * 已开始备餐的菜品需要档口确认后另行计入可售库存。
 */
export async function closeOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithItems,
  status: 'CANCELLED' | 'EXPIRED',
  now: Date,
  reason: string,
): Promise<boolean> {
  if (!canTransition(order.status, status)) return false;
  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: order.status },
    data: { status, cancelledAt: now, cancelledReason: reason },
  });
  if (claimed.count !== 1) return false;

  await tx.pickupSlot.updateMany({
    where: { id: order.pickupSlotId, booked: { gt: 0 } },
    data: { booked: { decrement: 1 } },
  });

  if (order.status === 'PENDING' || order.status === 'CONFIRMED') {
    for (const item of [...order.items].sort((a, b) => a.dishId.localeCompare(b.dishId))) {
      const inventory = await tx.inventory.findUnique({
        where: { dishId_date_mealType: { dishId: item.dishId, date: order.scheduledDate, mealType: order.mealType } },
        select: { id: true, total: true, remaining: true },
      });
      if (!inventory) continue;
      const quantity = Math.min(item.quantity, inventory.total - inventory.remaining);
      if (quantity > 0) {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { remaining: { increment: quantity }, version: { increment: 1 } },
        });
      }
    }
  }

  await tx.pickupToken.updateMany({
    where: { orderId: order.id, status: 'ACTIVE' },
    data: { status: status === 'EXPIRED' ? 'EXPIRED' : 'REVOKED' },
  });
  const label = status === 'EXPIRED' ? '已超时关闭' : '已取消';
  await tx.notification.create({
    data: {
      userId: order.userId, type: 'ORDER_CANCELLED', title: `订单${label}`,
      body: `订单 ${order.number} ${label}。`, data: { orderId: order.id },
    },
  });
  return true;
}
