/**
 * 订单模块：幂等下单、事务扣库存、时段容量、同档口约束、价格快照、
 * 状态流转、取消恢复库存、越权读取防护。
 * 支付只写 mock / 到店付款记录，绝不声称接入真实支付。
 */
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import {
  assertTransition, calculateOrderTotal, canTransition, checkSlotBookable, stockHoldingStatuses,
  type CartLine,
} from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser, CurrentUser, Errors, Roles, assertOwnerOrAdmin, assertStallScope, ok,
} from '../common';

class OrderLineDto {
  @IsString() dishId!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
}

class CreateOrderDto {
  @IsString() stallId!: string;
  @IsString() pickupSlotId!: string;
  @IsString() scheduledDate!: string; // YYYY-MM-DD
  @IsString() mealType!: string;      // BREAKFAST | LUNCH | DINNER
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @IsString() idempotencyKey!: string; // 客户端生成，防重复提交
  @IsOptional() @IsString() @Max(120) note?: string;
}

class ChangeStatusDto {
  @IsString() status!: string;
  @IsOptional() @IsString() reason?: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private orderNumber(): string {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `SG${d}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    if (user.role === 'MERCHANT') throw Errors.forbidden('商户账号不能代学生下单');

    // 幂等：同一 key 重复提交直接返回首次创建的订单
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) throw Errors.forbidden('幂等键冲突');
      return { order: existing, idempotent: true };
    }

    const mealType = dto.mealType as 'BREAKFAST' | 'LUNCH' | 'DINNER';
    const date = new Date(`${dto.scheduledDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw Errors.invalidParam('日期格式不正确');

    const slot = await this.prisma.pickupSlot.findUnique({ where: { id: dto.pickupSlotId }, include: { stall: true } });
    if (!slot) throw Errors.notFound('取餐时段不存在');
    if (slot.stallId !== dto.stallId) throw Errors.invalidParam('时段与档口不一致');

    const slotCheck = checkSlotBookable({
      date: dto.scheduledDate, startTime: slot.startTime, endTime: slot.endTime,
      capacity: slot.capacity, booked: slot.booked, cutoffMinutes: slot.cutoffMinutes, isClosed: slot.isClosed,
    }, new Date().toISOString());
    if (!slotCheck.ok) {
      if (slotCheck.reason === 'FULL') throw Errors.slotFull();
      if (slotCheck.reason === 'PAST_CUTOFF') throw Errors.slotExpired();
      throw Errors.invalidParam('该时段不可预约');
    }

    const dishIds = dto.items.map((i) => i.dishId);
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: dishIds } },
      include: { menuItems: { where: { isAvailable: true, menu: { date, mealType, status: 'PUBLISHED' } } } },
    });
    if (dishes.length !== new Set(dishIds).size) throw Errors.notFound('部分菜品不存在');
    // 购物车跨档口会造成订单归属不一致：明确限制只能对同一档口下单
    const wrongStall = dishes.find((d) => d.stallId !== dto.stallId);
    if (wrongStall) throw Errors.invalidParam('一个订单只能包含同一档口的菜品，请分档口下单');
    const notOnMenu = dishes.find((d) => d.menuItems.length === 0 || d.status !== 'ACTIVE');
    if (notOnMenu) throw Errors.invalidParam(`${notOnMenu.name} 当前餐次不可点`);

    const lines: CartLine[] = dto.items.map((i) => {
      const dish = dishes.find((d) => d.id === i.dishId)!;
      return { dishId: dish.id, dishName: dish.name, unitPriceCents: dish.priceCents, quantity: i.quantity };
    });
    const { items: snapshots, totalCents } = calculateOrderTotal(lines);

    const result = await this.prisma.withSerializable(async (tx) => {
      // 重新读取时段，事务内再次校验容量（防并发超卖）
      const freshSlot = await tx.pickupSlot.findUnique({ where: { id: slot.id } });
      if (!freshSlot || freshSlot.booked >= freshSlot.capacity) throw Errors.slotFull();
      const slotUpdated = await tx.pickupSlot.updateMany({
        where: { id: slot.id, booked: { lte: freshSlot.capacity - 1 } },
        data: { booked: { increment: 1 } },
      });
      if (slotUpdated.count !== 1) throw Errors.slotFull();

      // 逐项扣减库存（乐观锁 + 条件更新，防超卖）
      for (const line of lines) {
        const inv = await tx.inventory.findUnique({
          where: { dishId_date_mealType: { dishId: line.dishId, date, mealType } },
        });
        if (!inv) throw Errors.inventoryConflict(`${line.dishName} 未配置库存`);
        const updated = await tx.inventory.updateMany({
          where: { id: inv.id, version: inv.version, remaining: { gte: line.quantity } },
          data: { remaining: { decrement: line.quantity }, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw Errors.inventoryConflict(`${line.dishName} 库存不足`);
      }

      const order = await tx.order.create({
        data: {
          number: this.orderNumber(),
          userId: user.id, stallId: dto.stallId, canteenId: slot.stall.canteenId,
          pickupSlotId: slot.id, mealType, scheduledDate: date,
          totalCents, idempotencyKey: dto.idempotencyKey, note: dto.note ?? null,
          status: 'PENDING',
          items: {
            create: snapshots.map((s) => ({
              dishId: s.dishId, dishName: s.dishName, quantity: s.quantity,
              unitPriceCents: s.unitPriceCents, subtotalCents: s.subtotalCents,
            })),
          },
          paymentOrders: {
            create: [{
              provider: 'mock', amountCents: totalCents, status: 'UNPAID', isMock: true,
              rawPayload: { mode: '到店付款', notice: '演示模式，未接入真实支付' } as unknown as Prisma.InputJsonValue,
            }],
          },
        },
        include: { items: true },
      });

      await tx.userBehavior.createMany({
        data: lines.map((l) => ({ userId: user.id, dishId: l.dishId, type: 'ORDER_CREATE' as const, payload: { orderId: order.id } as unknown as Prisma.InputJsonValue })),
      });
      await tx.notification.create({
        data: { userId: user.id, type: 'ORDER_CONFIRMED', title: '订单已提交', body: `订单 ${order.number} 已提交，等待商户确认。`, data: { orderId: order.id } as unknown as Prisma.InputJsonValue },
      });
      return order;
    });

    return { order: result, idempotent: false, paymentMode: '演示模式 · 到店付款（未接入真实支付）' };
  }

  async listMine(user: AuthUser, page = 1, pageSize = 10, status?: string) {
    const where: Prisma.OrderWhereInput = { userId: user.id, ...(status ? { status: status as never } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where, include: { items: true, stall: { include: { canteen: true } }, pickupSlot: true, pickupToken: true, reviews: { select: { id: true, dishId: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async detail(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, stall: { include: { canteen: true } }, pickupSlot: true, pickupToken: true, reviews: true },
    });
    if (!order) throw Errors.notFound('订单不存在');
    if (user.role === 'STUDENT') assertOwnerOrAdmin(user, order.userId);
    if (user.role === 'MERCHANT') assertStallScope(user, order.stallId);
    return order;
  }

  async cancel(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw Errors.notFound('订单不存在');
    assertOwnerOrAdmin(user, order.userId);
    assertTransition(order.status, 'CANCELLED');

    return this.prisma.withSerializable(async (tx) => {
      if (stockHoldingStatuses(order.status)) {
        for (const item of order.items) {
          await tx.inventory.updateMany({
            where: { dishId: item.dishId, date: order.scheduledDate, mealType: order.mealType },
            data: { remaining: { increment: item.quantity }, version: { increment: 1 } },
          });
        }
        await tx.pickupSlot.updateMany({ where: { id: order.pickupSlotId }, data: { booked: { decrement: 1 } } });
      }
      const updated = await tx.order.update({
        where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: '用户主动取消' },
      });
      await tx.notification.create({
        data: { userId: order.userId, type: 'ORDER_CANCELLED', title: '订单已取消', body: `订单 ${order.number} 已取消，库存与名额已释放。` },
      });
      return updated;
    });
  }

  /** 商户操作台：接单 / 备餐 / 待取餐 / 取消，按档口授权校验。 */
  async changeStatus(user: AuthUser, id: string, dto: ChangeStatusDto) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw Errors.notFound('订单不存在');
    assertStallScope(user, order.stallId);
    const next = dto.status as Parameters<typeof canTransition>[1];
    assertTransition(order.status as Parameters<typeof assertTransition>[0], next);

    // 商户取消走独立分支：学生取消接口带 owner 校验，商户不能复用
    if (dto.status === 'CANCELLED') {
      return this.prisma.withSerializable(async (tx) => {
        if (stockHoldingStatuses(order.status)) {
          for (const item of order.items) {
            await tx.inventory.updateMany({
              where: { dishId: item.dishId, date: order.scheduledDate, mealType: order.mealType },
              data: { remaining: { increment: item.quantity }, version: { increment: 1 } },
            });
          }
          await tx.pickupSlot.updateMany({ where: { id: order.pickupSlotId }, data: { booked: { decrement: 1 } } });
        }
        const cancelled = await tx.order.update({
          where: { id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: dto.reason ?? '商户取消' },
        });
        await tx.notification.create({
          data: { userId: order.userId, type: 'ORDER_CANCELLED', title: '订单已取消', body: `订单 ${order.number} 由商户取消，名额与库存已释放。` },
        });
        return cancelled;
      });
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: next,
        ...(next === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
        ...(next === 'READY' ? { readyAt: new Date() } : {}),
        ...(next === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(next === 'CANCELLED' ? { cancelledAt: new Date(), cancelledReason: dto.reason ?? '商户取消' } : {}),
      },
    });

    const notifyType: Record<string, 'ORDER_CONFIRMED' | 'ORDER_PREPARING' | 'ORDER_READY' | 'ORDER_COMPLETED' | 'ORDER_CANCELLED' | undefined> = {
      CONFIRMED: 'ORDER_CONFIRMED', PREPARING: 'ORDER_PREPARING', READY: 'ORDER_READY',
      COMPLETED: 'ORDER_COMPLETED', CANCELLED: 'ORDER_CANCELLED',
    };
    const type = notifyType[dto.status];
    if (type) {
      await this.prisma.notification.create({
        data: { userId: order.userId, type, title: '订单状态更新', body: `订单 ${order.number} 状态变为 ${dto.status}。` },
      });
      if (dto.status === 'COMPLETED') {
        await this.prisma.notification.create({
          data: { userId: order.userId, type: 'REVIEW_REMINDER', title: '评价这一餐', body: '花 10 秒打个分，食光会更懂你的口味。' },
        });
      }
    }
    return updated;
  }

  async stallBoard(user: AuthUser, date?: string) {
    const where: Prisma.OrderWhereInput = {
      scheduledDate: new Date(`${date ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`),
      ...(user.role === 'MERCHANT' ? { stallId: { in: user.stallIds ?? [] } } : {}),
    };
    const rows = await this.prisma.order.findMany({
      where, include: { items: true, pickupSlot: true, user: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return rows;
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return ok(await this.service.create(user, dto), '订单已创建');
  }

  @Get()
  async listMine(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') pageSize = '10', @Query('status') status?: string) {
    return ok(await this.service.listMine(user, Number(page), Number(pageSize), status));
  }

  @Roles('MERCHANT', 'ADMIN')
  @Get('stall/board')
  async board(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return ok(await this.service.stallBoard(user, date));
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.service.detail(user, id));
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.service.cancel(user, id), '订单已取消');
  }

  @Roles('MERCHANT', 'ADMIN')
  @Post(':id/status')
  async status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ChangeStatusDto) {
    return ok(await this.service.changeStatus(user, id, dto), '状态已更新');
  }
}

@Module({ controllers: [OrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
