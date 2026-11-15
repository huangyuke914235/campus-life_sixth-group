/**
 * 取餐模块：时段容量、取餐码 / 二维码、后端核销。
 * 核销由后端校验订单状态、档口、凭证有效期并做条件更新防重放；
 * 仅修改前端状态无法完成取餐。
 */
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { randomInt } from 'node:crypto';
import * as QRCode from 'qrcode';
import { generatePickupCode, validatePickup } from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser, CurrentUser, Errors, Roles, assertOwnerOrAdmin, assertStallScope, ok,
} from '../common';

class VerifyDto {
  @IsString() code!: string;
  @IsString() stallId!: string;
}

class SlotDto {
  @IsString() stallId!: string;
  @IsString() date!: string;
  @IsString() mealType!: string;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  @IsInt() @Min(1) capacity!: number;
  @IsInt() @Min(0) cutoffMinutes!: number;
}

@Injectable()
export class PickupService {
  constructor(private readonly prisma: PrismaService) {}

  async slots(stallId: string, date: string, mealType: string) {
    const rows = await this.prisma.pickupSlot.findMany({
      where: { stallId, date: new Date(`${date}T00:00:00Z`), mealType: mealType as never },
      orderBy: { startTime: 'asc' },
    });
    const now = new Date().toISOString();
    return rows.map((s) => ({
      id: s.id, startTime: s.startTime, endTime: s.endTime,
      capacity: s.capacity, booked: s.booked, remaining: Math.max(0, s.capacity - s.booked),
      isClosed: s.isClosed,
      bookable: validatePickupSlot(s, date, now),
    }));
  }

  async createSlot(user: AuthUser, dto: SlotDto) {
    assertStallScope(user, dto.stallId);
    const existing = await this.prisma.pickupSlot.findUnique({
      where: {
        stallId_date_mealType_startTime: {
          stallId: dto.stallId,
          date: new Date(`${dto.date}T00:00:00Z`),
          mealType: dto.mealType as never,
          startTime: dto.startTime,
        },
      },
    });
    if (existing) throw Errors.invalidParam('该时段已存在');
    return this.prisma.pickupSlot.create({
      data: {
        stallId: dto.stallId, date: new Date(`${dto.date}T00:00:00Z`), mealType: dto.mealType as never,
        startTime: dto.startTime, endTime: dto.endTime, capacity: dto.capacity, cutoffMinutes: dto.cutoffMinutes,
      },
    });
  }

  /** 惰性生成取餐凭证：订单确认后才可见，6 位码 + 二维码。 */
  async token(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId }, include: { pickupSlot: true, pickupToken: true, stall: true },
    });
    if (!order) throw Errors.notFound('订单不存在');
    assertOwnerOrAdmin(user, order.userId);
    if (order.status === 'CANCELLED' || order.status === 'EXPIRED') throw Errors.invalidParam('订单已取消或过期');

    let token = order.pickupToken;
    if (!token) {
      let code = generatePickupCode(() => randomInt(0, 10) / 10);
      // 极低概率撞码，重试一次即可
      if (await this.prisma.pickupToken.findUnique({ where: { code } })) {
        code = generatePickupCode(() => randomInt(0, 10) / 10);
      }
      const payload = JSON.stringify({ orderId: order.id, number: order.number, stallId: order.stallId, code });
      const expiresAt = new Date(`${order.scheduledDate.toISOString().slice(0, 10)}T${order.pickupSlot.endTime}:00+08:00`);
      token = await this.prisma.pickupToken.create({
        data: { orderId: order.id, code, qrPayload: payload, expiresAt },
      });
    }
    const qrDataUrl = await QRCode.toDataURL(token.qrPayload, { margin: 1, width: 240 });
    return {
      code: token.code, status: token.status, expiresAt: token.expiresAt,
      qrDataUrl, stallName: order.stall.name,
      slot: `${order.pickupSlot.startTime}–${order.pickupSlot.endTime}`,
      notice: '请向档口工作人员出示二维码或报取餐码；凭证由后端核销。',
    };
  }

  async verify(user: AuthUser, dto: VerifyDto) {
    assertStallScope(user, dto.stallId);
    const token = await this.prisma.pickupToken.findUnique({
      where: { code: dto.code }, include: { order: true },
    });
    if (!token) throw Errors.tokenInvalid('取餐码不存在');

    const check = validatePickup({
      tokenStatus: token.status as 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED',
      orderStatus: token.order.status as never,
      expiresAt: token.expiresAt.toISOString(),
      orderStallId: token.order.stallId,
      requestStallId: dto.stallId,
      now: new Date().toISOString(),
    });
    if (!check.ok) {
      if (check.reason === 'TOKEN_NOT_ACTIVE') throw Errors.tokenInvalid('该取餐码已被核销');
      if (check.reason === 'TOKEN_EXPIRED') throw Errors.tokenInvalid('取餐码已过期');
      if (check.reason === 'STALL_MISMATCH') throw Errors.forbidden('该订单不属于此档口');
      throw Errors.tokenInvalid('订单尚未备好，暂不能核销');
    }

    return this.prisma.withSerializable(async (tx) => {
      // 条件更新保证并发下只有一个请求能核销成功
      const claimed = await tx.pickupToken.updateMany({
        where: { id: token.id, status: 'ACTIVE' },
        data: { status: 'USED', usedAt: new Date(), usedByUserId: user.id },
      });
      if (claimed.count !== 1) throw Errors.tokenInvalid('该取餐码已被核销');
      const order = await tx.order.update({
        where: { id: token.orderId },
        data: { status: 'COMPLETED', completedAt: new Date(), paymentStatus: 'MOCK_PAID' },
      });
      await tx.notification.create({
        data: { userId: token.order.userId, type: 'REVIEW_REMINDER', title: '评价这一餐', body: '取餐完成，花 10 秒打个分，食光会更懂你的口味。' },
      });
      return { orderId: order.id, number: order.number, verifiedAt: order.completedAt, paymentNote: '演示模式 · 到店付款' };
    });
  }
}

function validatePickupSlot(s: { startTime: string; capacity: number; booked: number; isClosed: boolean; cutoffMinutes: number }, date: string, nowIso: string): boolean {
  if (s.isClosed || s.booked >= s.capacity) return false;
  const [h, m] = s.startTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCHours(h - 8, m - s.cutoffMinutes, 0, 0);
  return new Date(nowIso).getTime() <= cutoff.getTime();
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
