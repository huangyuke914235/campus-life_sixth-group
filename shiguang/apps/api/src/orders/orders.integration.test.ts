import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BizCode, type AuthUser } from '../common';
import { PickupService } from '../pickup/pickup.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersTask } from '../tasks/tasks.module';
import { OrdersService } from './orders.module';

const databaseUrl = process.env.ORDER_TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const now = new Date('2026-11-12T03:30:00Z');
const scheduledDate = '2026-11-12';
const date = new Date(scheduledDate + 'T00:00:00Z');
const mealType = 'LUNCH' as const;

describe.runIf(Boolean(databaseUrl))('订单与取餐 · PostgreSQL', () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let pickup: PickupService;
  let tasks: OrdersTask;
  const fixtureIds: { userIds: string[]; stallId: string; canteenId: string }[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[a-z][a-z0-9_]*_test(?:_[a-z0-9_]+)?$/i.test(url.pathname)) {
      throw new Error('ORDER_TEST_DATABASE_URL 必须显式指向专用 PostgreSQL 测试库');
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    orders = new OrdersService(prisma);
    pickup = new PickupService(prisma);
    tasks = new OrdersTask(prisma, new ConfigService());
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const { userIds, stallId, canteenId } of fixtureIds.splice(0)) {
      await prisma.$transaction([
        prisma.paymentOrder.deleteMany({ where: { order: { stallId } } }),
        prisma.order.deleteMany({ where: { stallId } }),
        prisma.userBehavior.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.menu.deleteMany({ where: { stallId } }),
        prisma.inventory.deleteMany({ where: { dish: { stallId } } }),
        prisma.pickupSlot.deleteMany({ where: { stallId } }),
        prisma.dish.deleteMany({ where: { stallId } }),
        prisma.stall.delete({ where: { id: stallId } }),
        prisma.canteen.delete({ where: { id: canteenId } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function fixture(quantity = 20, capacity = 20) {
    const suffix = randomUUID();
    const canteen = await prisma.canteen.create({
      data: { name: suffix, location: '测试食堂', openTime: '07:00', closeTime: '20:00' },
    });
    const stall = await prisma.stall.create({ data: { canteenId: canteen.id, name: '测试档口' } });
    const userIds: string[] = [];
    fixtureIds.push({ userIds, stallId: stall.id, canteenId: canteen.id });
    const users = await Promise.all(['student', 'second', 'merchant'].map(async (name): Promise<AuthUser> => {
      const role = name === 'merchant' ? 'MERCHANT' : 'STUDENT';
      const row = await prisma.user.create({
        data: { email: name + '.' + suffix + '@example.invalid', displayName: name, passwordHash: 'fixture', role },
      });
      userIds.push(row.id);
      return { id: row.id, email: row.email, displayName: row.displayName, role, stallIds: [stall.id] };
    }));
    const [student, second, merchant] = users;
    const dish = await prisma.dish.create({
      data: { stallId: stall.id, name: '测试菜品', category: '米饭', priceCents: 1200 },
    });
    await prisma.menu.create({
      data: { stallId: stall.id, date, mealType, status: 'PUBLISHED', items: { create: { dishId: dish.id } } },
    });
    const inventory = await prisma.inventory.create({
      data: { dishId: dish.id, date, mealType, total: quantity, remaining: quantity },
    });
    const slot = await prisma.pickupSlot.create({
      data: { stallId: stall.id, date, mealType, startTime: '12:00', endTime: '12:30', cutoffMinutes: 15, capacity },
    });
    return {
      student, second, merchant, inventory, slot, dish,
      request: {
        stallId: stall.id, pickupSlotId: slot.id, scheduledDate, mealType,
        items: [{ dishId: dish.id, quantity: 1, expectedUnitPriceCents: 1200 }],
        idempotencyKey: randomUUID(),
      },
    };
  }

  async function makeReady(f: Awaited<ReturnType<typeof fixture>>) {
    const { order } = await orders.create(f.student, f.request);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY'] as const) {
      await orders.changeStatus(f.merchant, order.id, { status });
    }
    const token = await pickup.token(f.student, order.id);
    return { order, token };
  }

  it('20 次同键重试只创建一单；同键异内容冲突；其他账号使用自己的作用域', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 20 }, () => orders.create(f.student, f.request)));
    const orderId = results[0].order.id;
    expect(new Set(results.map((row) => row.order.id))).toEqual(new Set([orderId]));
    expect(results.filter((row) => !row.idempotent)).toHaveLength(1);
    await expect(orders.create(f.student, { ...f.request, note: 'changed' })).rejects.toMatchObject({
      bizCode: BizCode.DUPLICATE_ORDER, httpStatus: 409,
    });
    const other = await orders.create(f.second, f.request);
    expect(other.order.id).not.toBe(orderId);
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 18 });
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 2 });
  }, 20_000);

  it.each([
    { stock: 1, capacity: 20, error: BizCode.INVENTORY_CONFLICT },
    { stock: 20, capacity: 1, error: BizCode.SLOT_FULL },
  ])('20 个并发订单争抢库存 $stock、名额 $capacity 时只有一单成功', async ({ stock, capacity, error }) => {
    const f = await fixture(stock, capacity);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => orders.create(f.student, {
      ...f.request, idempotencyKey: randomUUID(),
    })));
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    for (const row of results) {
      if (row.status === 'rejected') expect(row.reason).toMatchObject({ bizCode: error });
    }
    expect(await prisma.order.count({ where: { pickupSlotId: f.slot.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.student.id } })).toBe(1);
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: stock - 1 });
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 1 });
  }, 20_000);

  it('拒绝错配、过期和旧价格，库存和名额无副作用', async () => {
    const f = await fixture();
    await expect(orders.create(f.student, { ...f.request, scheduledDate: '2026-11-13' })).rejects.toMatchObject({
      bizCode: BizCode.INVALID_PARAM,
    });
    await expect(orders.create(f.student, {
      ...f.request, items: [{ ...f.request.items[0], expectedUnitPriceCents: 1000 }],
    })).rejects.toMatchObject({
      bizCode: BizCode.PRICE_CHANGED, details: { prices: [{ dishId: f.dish.id, unitPriceCents: 1200 }] },
    });
    vi.setSystemTime(new Date('2026-11-12T03:45:00.001Z'));
    await expect(orders.create(f.student, f.request)).rejects.toMatchObject({ bizCode: BizCode.SLOT_EXPIRED });
    expect(await pickup.slots(f.slot.stallId, scheduledDate, mealType)).toEqual([
      expect.objectContaining({ id: f.slot.id, bookable: false }),
    ]);
    expect(await prisma.order.count({ where: { pickupSlotId: f.slot.id } })).toBe(0);
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 0 });
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 20 });
  });

  it('并发取消只释放一次，库存回补不超过总量', async () => {
    const f = await fixture();
    const { order } = await orders.create(f.student, f.request);
    const duplicate = await orders.create(f.student, { ...f.request, idempotencyKey: randomUUID() });
    const results = await Promise.allSettled([orders.cancel(f.student, order.id), orders.cancel(f.student, order.id)]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 1 });
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 19 });

    await prisma.inventory.update({ where: { id: f.inventory.id }, data: { remaining: 20 } });
    await orders.cancel(f.student, duplicate.order.id);
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 0 });
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 20 });
  });

  it('迁移前没有请求指纹的订单可安全重试，仍以历史成交价为准', async () => {
    const f = await fixture();
    const old = await prisma.order.create({
      data: {
        number: 'legacy-' + randomUUID(), userId: f.student.id, stallId: f.slot.stallId,
        canteenId: (await prisma.stall.findUniqueOrThrow({ where: { id: f.slot.stallId } })).canteenId,
        pickupSlotId: f.slot.id, scheduledDate: date, mealType, totalCents: 1200,
        idempotencyKey: f.request.idempotencyKey,
        items: { create: { dishId: f.dish.id, dishName: f.dish.name, quantity: 1, unitPriceCents: 1200, subtotalCents: 1200 } },
      },
    });
    await prisma.dish.update({ where: { id: f.dish.id }, data: { priceCents: 1500 } });
    expect(await orders.create(f.student, f.request)).toMatchObject({
      order: { id: old.id, totalCents: 1200 }, idempotent: true,
    });
    await expect(orders.create(f.student, { ...f.request, note: 'changed' })).rejects.toMatchObject({
      bizCode: BizCode.DUPLICATE_ORDER,
    });
    expect(await prisma.order.count({ where: { pickupSlotId: f.slot.id } })).toBe(1);
  });

  it('并发核销只成功一次，同时写入支付和评价提醒', async () => {
    const f = await fixture();
    const { order, token } = await makeReady(f);
    const request = { code: token.code, stallId: f.slot.stallId };
    const results = await Promise.allSettled([pickup.verify(f.merchant, request), pickup.verify(f.merchant, request)]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'COMPLETED', paymentStatus: 'MOCK_PAID' });
    expect(await prisma.pickupToken.findUnique({ where: { orderId: order.id } })).toMatchObject({ status: 'USED' });
    expect(await prisma.paymentOrder.findFirst({ where: { orderId: order.id } })).toMatchObject({ status: 'MOCK_PAID' });
    expect(await prisma.notification.count({ where: { userId: f.student.id, type: 'REVIEW_REMINDER' } })).toBe(1);
  });

  it('并发取码得到同一凭证，另一档口无法核销', async () => {
    const f = await fixture();
    const { order } = await orders.create(f.student, f.request);
    await orders.changeStatus(f.merchant, order.id, { status: 'CONFIRMED' });
    const tokens = await Promise.all(Array.from({ length: 10 }, () => pickup.token(f.student, order.id)));
    expect(new Set(tokens.map(({ code }) => code)).size).toBe(1);
    expect(await prisma.pickupToken.count({ where: { orderId: order.id } })).toBe(1);
    await expect(pickup.verify({ ...f.merchant, stallIds: ['other'] }, {
      code: tokens[0].code, stallId: 'other',
    })).rejects.toMatchObject({ bizCode: BizCode.FORBIDDEN });
  });

  it('取消与核销只能有一个终态，已备餐库存不会自动回补', async () => {
    const f = await fixture();
    const { order, token } = await makeReady(f);
    const results = await Promise.allSettled([
      orders.cancel(f.student, order.id),
      pickup.verify(f.merchant, { code: token.code, stallId: f.slot.stallId }),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(['CANCELLED', 'COMPLETED']).toContain(final.status);
    expect(await prisma.pickupToken.findUnique({ where: { orderId: order.id } })).toMatchObject({
      status: final.status === 'CANCELLED' ? 'REVOKED' : 'USED',
    });
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 19 });
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({
      booked: final.status === 'CANCELLED' ? 0 : 1,
    });
  });

  it('按实际取餐截止扫描 READY，重复任务不重复释放且保留未来预约', async () => {
    const f = await fixture();
    const { order, token } = await makeReady(f);
    const future = await prisma.pickupSlot.create({
      data: { stallId: f.slot.stallId, date, mealType, startTime: '13:00', endTime: '13:30', capacity: 5 },
    });
    const futureOrder = await orders.create(f.student, { ...f.request, idempotencyKey: randomUUID(), pickupSlotId: future.id });
    expect(await tasks.expireStale(now)).toMatchObject({ expired: 0 });
    const end = new Date('2026-11-12T04:30:00Z');
    vi.setSystemTime(end);
    await expect(pickup.verify(f.merchant, { code: token.code, stallId: f.slot.stallId }))
      .rejects.toMatchObject({ bizCode: BizCode.TOKEN_INVALID });
    expect(await tasks.expireStale(end)).toEqual({ expired: 1, orders: [order.number] });
    expect(tasks.getLastSuccessfulScanAt()).toBe(end.toISOString());
    expect(await tasks.expireStale(end)).toMatchObject({ expired: 0 });
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toMatchObject({ status: 'EXPIRED' });
    expect(await prisma.order.findUnique({ where: { id: futureOrder.order.id } })).toMatchObject({ status: 'PENDING' });
    expect(await prisma.pickupToken.findUnique({ where: { code: token.code } })).toMatchObject({ status: 'EXPIRED' });
    expect(await prisma.inventory.findUnique({ where: { id: f.inventory.id } })).toMatchObject({ remaining: 18 });
    expect(await prisma.pickupSlot.findUnique({ where: { id: f.slot.id } })).toMatchObject({ booked: 0 });
  });

  it('暂停新预约后已有订单仍可重试、取消和核销', async () => {
    const f = await fixture();
    const { order, token } = await makeReady(f);
    const pending = await orders.create(f.student, { ...f.request, idempotencyKey: randomUUID() });
    const paused = new OrdersService(prisma, new ConfigService({ ORDER_BOOKING_PAUSED: 'true' }));
    await expect(paused.create(f.student, { ...f.request, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      bizCode: BizCode.ORDER_BOOKING_PAUSED, httpStatus: 503,
    });
    expect(await paused.create(f.student, f.request)).toMatchObject({ order: { id: order.id }, idempotent: true });
    expect(await paused.cancel(f.student, pending.order.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await pickup.verify(f.merchant, { code: token.code, stallId: f.slot.stallId })).toMatchObject({ orderId: order.id });
    expect(await prisma.order.count({ where: { pickupSlotId: f.slot.id } })).toBe(2);
  });
});
