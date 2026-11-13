/**
 * 订单模块：幂等下单、事务扣库存、时段容量、同档口约束、价格快照和状态流转。
 */
import { Body, ConflictException, Controller, Get, Injectable, Module, Optional, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  calculateOrderTotal, campusDate, canTransition, checkSlotBookable, MEAL_TYPES, parseCampusDate,
  type CartLine, type MealType,
} from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertOwnerOrAdmin, assertStallScope, ok } from '../common';
import { closeOrder } from './order-lifecycle';

class OrderLineDto {
  @IsString() @IsNotEmpty() dishId!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsInt() @Min(0) expectedUnitPriceCents?: number;
}

class CreateOrderDto {
  @IsOptional() @IsString() stallId?: string;
  @IsString() @IsNotEmpty() pickupSlotId!: string;
  @IsOptional() @IsString() scheduledDate?: string;
  @IsOptional() @IsIn([...MEAL_TYPES]) mealType?: MealType;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  items!: OrderLineDto[];
  @IsString() @IsNotEmpty() @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(120) note?: string;
}

const STAFF_STATUSES = ['CONFIRMED', 'PREPARING', 'READY', 'CANCELLED'] as const;
const STATUS_NOTIFICATIONS = {
  CONFIRMED: { type: 'ORDER_CONFIRMED', label: '已确认' },
  PREPARING: { type: 'ORDER_PREPARING', label: '备餐中' },
  READY: { type: 'ORDER_READY', label: '待取餐' },
} as const;

class ChangeStatusDto {
  @IsIn([...STAFF_STATUSES]) status!: (typeof STAFF_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

function orderMatchesContext(
  dto: CreateOrderDto,
  context: { stallId: string; date: Date; mealType: MealType },
): boolean {
  return (dto.stallId == null || dto.stallId === context.stallId)
    && (dto.scheduledDate == null || dto.scheduledDate === context.date.toISOString().slice(0, 10))
    && (dto.mealType == null || dto.mealType === context.mealType);
}

function publicOrder<T extends { requestFingerprint: string | null }>(row: T): Omit<T, 'requestFingerprint'> {
  const { requestFingerprint: _requestFingerprint, ...order } = row;
  return order;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private idempotentResult(order: OrderWithItems, dto: CreateOrderDto, fingerprint: string) {
    const matchesContext = orderMatchesContext(dto, {
      stallId: order.stallId, date: order.scheduledDate, mealType: order.mealType,
    });
    // 迁移前订单没有指纹，使用已保存的订单明细和成交快照判断重试。
    const matchesRequest = order.requestFingerprint ? order.requestFingerprint === fingerprint : (
      order.pickupSlotId === dto.pickupSlotId && order.note === (dto.note ?? null)
      && order.items.length === dto.items.length
      && dto.items.every((line) => order.items.some((item) => item.dishId === line.dishId
        && item.quantity === line.quantity
        && (line.expectedUnitPriceCents == null || line.expectedUnitPriceCents === item.unitPriceCents)))
    );
    if (!matchesContext || !matchesRequest) throw Errors.duplicateOrder('同一个幂等键已用于不同的订单请求');
    return { order: publicOrder(order), idempotent: true };
  }

  async create(user: AuthUser, dto: CreateOrderDto) {
    if (user.role === 'MERCHANT') throw Errors.forbidden('商户账号不能代学生下单');
    const requested = [...dto.items].sort((a, b) => a.dishId.localeCompare(b.dishId));
    if (new Set(requested.map((item) => item.dishId)).size !== requested.length) {
      throw Errors.invalidParam('同一菜品不能重复出现在订单中');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      pickupSlotId: dto.pickupSlotId,
      note: dto.note ?? null,
      items: requested.map((line) => [line.dishId, line.quantity, line.expectedUnitPriceCents ?? null]),
    })).digest('hex');
    const identity = { userId_idempotencyKey: { userId: user.id, idempotencyKey: dto.idempotencyKey } };

    try {
      return await this.prisma.withSerializable(async (tx) => {
        const existing = await tx.order.findUnique({ where: identity, include: { items: true } });
        if (existing) return this.idempotentResult(existing, dto, fingerprint);
        if (this.config?.get('ORDER_BOOKING_PAUSED') === 'true') throw Errors.orderBookingPaused();

        const slot = await tx.pickupSlot.findUnique({
          where: { id: dto.pickupSlotId }, include: { stall: { include: { canteen: true } } },
        });
        if (!slot) throw Errors.notFound('取餐时段不存在');
        if (!orderMatchesContext(dto, slot)) throw Errors.invalidParam('取餐时段与档口、日期或餐次不一致');
        if (!slot.stall.isActive || !slot.stall.canteen.isOpen) throw Errors.invalidParam('该档口当前不可预约');
        const now = new Date();
        const { stallId, date, mealType } = slot;
        const slotCheck = checkSlotBookable({
          ...slot, date: date.toISOString().slice(0, 10),
        }, now.toISOString());
        if (!slotCheck.ok) {
          if (slotCheck.reason === 'FULL') throw Errors.slotFull();
          if (slotCheck.reason === 'PAST_CUTOFF') throw Errors.slotExpired();
          throw Errors.invalidParam('该时段不可预约');
        }

        const dishes = await tx.dish.findMany({
          where: { id: { in: requested.map((item) => item.dishId) } },
          include: { menuItems: { where: { isAvailable: true, menu: { stallId, date, mealType, status: 'PUBLISHED' } } } },
        });
        if (dishes.length !== requested.length) throw Errors.notFound('部分菜品不存在');
        const byId = new Map(dishes.map((dish) => [dish.id, dish]));
        const lines: CartLine[] = requested.map((item) => {
          const dish = byId.get(item.dishId)!;
          if (dish.stallId !== stallId) throw Errors.invalidParam('一个订单只能包含同一档口的菜品，请分档口下单');
          if (dish.status !== 'ACTIVE' || dish.menuItems.length === 0) {
            throw Errors.invalidParam(`${dish.name} 当前餐次不可点`);
          }
          return { dishId: dish.id, dishName: dish.name, unitPriceCents: dish.priceCents, quantity: item.quantity };
        });
        if (requested.some((item) => item.expectedUnitPriceCents != null
          && item.expectedUnitPriceCents !== byId.get(item.dishId)!.priceCents)) {
          throw Errors.priceChanged(lines.map(({ dishId, unitPriceCents }) => ({ dishId, unitPriceCents })));
        }

        const { items: snapshots, totalCents } = calculateOrderTotal(lines);
        const slotUpdated = await tx.pickupSlot.updateMany({
          where: { id: slot.id, isClosed: false, booked: { lt: slot.capacity } },
          data: { booked: { increment: 1 } },
        });
        if (slotUpdated.count !== 1) throw Errors.slotFull();

        for (const line of lines) {
          const updated = await tx.inventory.updateMany({
            where: { dishId: line.dishId, date, mealType, remaining: { gte: line.quantity } },
            data: { remaining: { decrement: line.quantity }, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw Errors.inventoryConflict(`${line.dishName} 库存不足或未配置库存`);
        }

        const order = await tx.order.create({
          data: {
            number: `SG${campusDate(now).replace(/-/g, '')}${randomUUID().slice(0, 18).replace(/-/g, '').toUpperCase()}`,
            userId: user.id, stallId, canteenId: slot.stall.canteenId,
            pickupSlotId: slot.id, mealType, scheduledDate: date,
            totalCents, idempotencyKey: dto.idempotencyKey, requestFingerprint: fingerprint, note: dto.note ?? null,
            items: { create: snapshots },
            paymentOrders: {
              create: [{ provider: 'mock', amountCents: totalCents, status: 'UNPAID', isMock: true, rawPayload: { mode: '到店付款' } }],
            },
          },
          include: { items: true },
        });

        await tx.userBehavior.createMany({
          data: lines.map((line) => ({ userId: user.id, dishId: line.dishId, type: 'ORDER_CREATE' as const, payload: { orderId: order.id } })),
        });
        await tx.notification.create({
          data: { userId: user.id, type: 'ORDER_CONFIRMED', title: '订单已提交', body: `订单 ${order.number} 已提交，等待商户确认。`, data: { orderId: order.id } },
        });
        return { order: publicOrder(order), idempotent: false, paymentMode: '演示模式 · 到店付款（未接入真实支付）' };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        const existing = await this.prisma.order.findUnique({ where: identity, include: { items: true } });
        if (existing) return this.idempotentResult(existing, dto, fingerprint);
        throw new ConflictException('订单提交时发生冲突，请刷新后重试');
      }
      throw error;
    }
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
    return { items: rows.map(publicOrder), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async detail(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, stall: { include: { canteen: true } }, pickupSlot: true, pickupToken: true, reviews: true },
    });
    if (!order) throw Errors.notFound('订单不存在');
    if (user.role === 'STUDENT') assertOwnerOrAdmin(user, order.userId);
    if (user.role === 'MERCHANT') assertStallScope(user, order.stallId);
    const visible = publicOrder(order);
    // 档口需要核对由学生出示的凭证，订单详情不向商户返回取餐码。
    if (user.role === 'MERCHANT') visible.pickupToken = null;
    return visible;
  }

  async cancel(user: AuthUser, id: string) {
    return this.prisma.withSerializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw Errors.notFound('订单不存在');
      assertOwnerOrAdmin(user, order.userId);
      await this.cancelOrder(tx, order, '用户主动取消');
      return publicOrder(await tx.order.findUniqueOrThrow({ where: { id } }));
    });
  }

  private async cancelOrder(tx: Prisma.TransactionClient, order: OrderWithItems, reason: string) {
    if (!await closeOrder(tx, order, 'CANCELLED', new Date(), reason)) {
      throw new ConflictException('订单当前状态不能取消，请刷新后重试');
    }
  }

  /** 商户操作台通过取餐码核销完成订单。 */
  async changeStatus(user: AuthUser, id: string, dto: ChangeStatusDto) {
    return this.prisma.withSerializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
      if (!order) throw Errors.notFound('订单不存在');
      assertStallScope(user, order.stallId);
      const next = dto.status;
      if (!STAFF_STATUSES.includes(next) || !canTransition(order.status, next)) {
        throw new ConflictException('订单当前状态不支持此操作，请刷新后重试');
      }

      if (next === 'CANCELLED') {
        await this.cancelOrder(tx, order, dto.reason ?? '商户取消');
      } else {
        const now = new Date();
        const updated = await tx.order.updateMany({
          where: { id, status: order.status },
          data: { status: next, ...(next === 'CONFIRMED' ? { confirmedAt: now } : {}), ...(next === 'READY' ? { readyAt: now } : {}) },
        });
        if (updated.count !== 1) throw new ConflictException('订单状态已变化，请刷新后重试');
        const { type, label } = STATUS_NOTIFICATIONS[next];
        await tx.notification.create({
          data: { userId: order.userId, type, title: '订单状态更新', body: `订单 ${order.number} ${label}。`, data: { orderId: id } },
        });
      }
      return publicOrder(await tx.order.findUniqueOrThrow({ where: { id } }));
    });
  }

  async stallBoard(user: AuthUser, date?: string) {
    const scheduledDate = parseCampusDate(date ?? campusDate(new Date()));
    if (!scheduledDate) throw Errors.invalidParam('日期格式不正确');
    const where: Prisma.OrderWhereInput = {
      scheduledDate, ...(user.role === 'MERCHANT' ? { stallId: { in: user.stallIds ?? [] } } : {}),
    };
    const rows = await this.prisma.order.findMany({
      where, include: { items: true, pickupSlot: true, user: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return rows.map(publicOrder);
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
