/** 服务端验证时段、凭证有效期、档口与一次性核销。 */
import { Body, ConflictException, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import * as QRCode from 'qrcode';
import {
  campusTime, checkSlotBookable, MEAL_TYPES, parseCampusDate, validatePickup, type MealType,
} from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertOwnerOrAdmin, assertStallScope, ok } from '../common';

class VerifyDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
  @IsString() @IsNotEmpty() stallId!: string;
}

class SlotDto {
  @IsString() @IsNotEmpty() stallId!: string;
  @IsString() date!: string;
  @IsIn([...MEAL_TYPES]) mealType!: MealType;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  @IsInt() @Min(1) capacity!: number;
  @IsInt() @Min(0) cutoffMinutes!: number;
}

@Injectable()
export class PickupService {
  constructor(private readonly prisma: PrismaService) {}

  async slots(stallId: string, date: string, mealType: string) {
    const day = parseCampusDate(date);
    if (!stallId || !day || !MEAL_TYPES.includes(mealType as MealType)) {
      throw Errors.invalidParam('请提供有效的档口、日期和餐次');
    }
    const rows = await this.prisma.pickupSlot.findMany({
      where: { stallId, date: day, mealType: mealType as MealType },
      include: { stall: { select: { isActive: true, canteen: { select: { isOpen: true } } } } },
      orderBy: { startTime: 'asc' },
    });
    const now = new Date().toISOString();
    return rows.map((slot) => ({
      id: slot.id, startTime: slot.startTime, endTime: slot.endTime,
      capacity: slot.capacity, booked: slot.booked,
      remaining: slot.booked < 0 ? 0 : Math.max(0, slot.capacity - slot.booked),
      isClosed: slot.isClosed,
      bookable: slot.stall.isActive && slot.stall.canteen.isOpen && checkSlotBookable({ ...slot, date }, now).ok,
    }));
  }

  async createSlot(user: AuthUser, dto: SlotDto) {
    assertStallScope(user, dto.stallId);
    const date = parseCampusDate(dto.date);
    const start = campusTime(dto.date, dto.startTime);
    const end = campusTime(dto.date, dto.endTime);
    if (!date || !start || !end || start >= end) {
      throw Errors.invalidParam('取餐时段的日期或起止时间不正确');
    }

    try {
      return await this.prisma.pickupSlot.create({ data: { ...dto, date } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该时段已存在');
      }
      throw error;
    }
  }

  /** 订单确认后按需生成凭证。数据库唯一索引协调并发读码与随机码碰撞。 */
  async token(user: AuthUser, orderId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const { order, token } = await this.prisma.withSerializable(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId }, include: { pickupSlot: true, pickupToken: true, stall: true },
          });
          if (!order) throw Errors.notFound('订单不存在');
          assertOwnerOrAdmin(user, order.userId);
          if (order.status === 'COMPLETED' && order.pickupToken?.status === 'USED') {
            return { order, token: order.pickupToken };
          }
          if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
            throw Errors.tokenInvalid('订单已取消或过期');
          }
          if (!['CONFIRMED', 'PREPARING', 'READY'].includes(order.status)) {
            throw Errors.tokenInvalid('当前订单没有可用的取餐凭证');
          }

          const { date, endTime } = order.pickupSlot;
          const expiresAt = campusTime(date.toISOString().slice(0, 10), endTime);
          const now = new Date();
          if (!expiresAt || expiresAt <= now || (order.pickupToken && order.pickupToken.expiresAt <= now)) {
            throw Errors.tokenInvalid('取餐凭证已过期');
          }
          if (order.pickupToken) return { order, token: order.pickupToken };

          const code = String(randomInt(1_000_000)).padStart(6, '0');
          const qrPayload = JSON.stringify({ orderId: order.id, number: order.number, stallId: order.stallId, code });
          const token = await tx.pickupToken.create({ data: { orderId: order.id, code, qrPayload, expiresAt } });
          return { order, token };
        });

        const qrDataUrl = await QRCode.toDataURL(token.qrPayload, { margin: 1, width: 240 });
        return {
          code: token.code, status: token.status, expiresAt: token.expiresAt, qrDataUrl,
          stallName: order.stall.name, slot: `${order.pickupSlot.startTime}–${order.pickupSlot.endTime}`,
          notice: '请向档口工作人员出示二维码或报取餐码。',
        };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
    throw new ConflictException('取餐凭证生成冲突，请刷新后重试');
  }

  async verify(user: AuthUser, dto: VerifyDto) {
    assertStallScope(user, dto.stallId);
    return this.prisma.withSerializable(async (tx) => {
      const token = await tx.pickupToken.findUnique({
        where: { code: dto.code }, include: { order: { include: { pickupSlot: true } } },
      });
      if (!token) throw Errors.tokenInvalid('取餐码不存在');
      if (token.order.stallId !== dto.stallId) throw Errors.forbidden('该订单不属于此档口');

      const now = new Date();
      const { order } = token;
      const { date, endTime } = order.pickupSlot;
      const slotDeadline = campusTime(date.toISOString().slice(0, 10), endTime);
      const check = validatePickup({
        tokenStatus: token.status,
        orderStatus: order.status,
        expiresAt: token.expiresAt.toISOString(),
        orderStallId: order.stallId,
        requestStallId: dto.stallId,
        now: now.toISOString(),
      });
      if (check.reason === 'TOKEN_NOT_ACTIVE') throw Errors.tokenInvalid('该取餐码已使用或失效');
      if (check.reason === 'TOKEN_EXPIRED' || !slotDeadline || now >= slotDeadline) {
        throw Errors.tokenInvalid('取餐码已过期');
      }
      if (!check.ok) throw Errors.tokenInvalid('订单尚未备好或已关闭，暂不能核销');

      const completed = await tx.order.updateMany({
        where: { id: order.id, status: 'READY', stallId: dto.stallId },
        data: { status: 'COMPLETED', completedAt: now, paymentStatus: 'MOCK_PAID' },
      });
      if (completed.count !== 1) throw Errors.tokenInvalid('订单状态已变化，请刷新后重试');
      const claimed = await tx.pickupToken.updateMany({
        where: { id: token.id, status: 'ACTIVE', expiresAt: { gt: now } },
        data: { status: 'USED', usedAt: now, usedByUserId: user.id },
      });
      if (claimed.count !== 1) throw Errors.tokenInvalid('该取餐码已使用或失效');

      await tx.paymentOrder.updateMany({
        where: { orderId: order.id, isMock: true, status: 'UNPAID' },
        data: { status: 'MOCK_PAID', paidAt: now },
      });
      await tx.notification.create({
        data: {
          userId: order.userId, type: 'REVIEW_REMINDER', title: '评价这一餐',
          body: '取餐完成，花 10 秒打个分，食光会更懂你的口味。', data: { orderId: order.id },
        },
      });
      return { orderId: order.id, number: order.number, verifiedAt: now, paymentNote: '演示模式 · 到店付款' };
    });
  }
}

@Controller('pickup')
export class PickupController {
  constructor(private readonly service: PickupService) {}

  @Get('slots')
  async slots(@Query('stallId') stallId: string, @Query('date') date: string, @Query('mealType') mealType: string) {
    return ok(await this.service.slots(stallId, date, mealType));
  }

  @Roles('MERCHANT', 'ADMIN')
  @Post('slots')
  async createSlot(@CurrentUser() user: AuthUser, @Body() dto: SlotDto) {
    return ok(await this.service.createSlot(user, dto), '时段已创建');
  }

  @Get('orders/:orderId/token')
  async token(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return ok(await this.service.token(user, orderId));
  }

  @Roles('MERCHANT', 'ADMIN')
  @Post('verify')
  async verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyDto) {
    return ok(await this.service.verify(user, dto), '核销成功');
  }
}

@Module({ controllers: [PickupController], providers: [PickupService], exports: [PickupService] })
export class PickupModule {}
