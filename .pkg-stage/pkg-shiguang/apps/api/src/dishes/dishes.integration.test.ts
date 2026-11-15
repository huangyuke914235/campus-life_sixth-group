import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../common';
import { PrismaService } from '../prisma/prisma.service';
import { DishesService } from './dishes.module';

/**
 * 任务 03 的验收用例。
 *
 * 重点不是"能不能改菜"，而是：
 *   1. 跨档口改菜必须 403（越权）
 *   2. 请求体里夹带 stallId / avgRating / status 必须被丢弃（白名单）
 *
 * 第 2 类攻击在 TypeScript 编译期传不进去（DTO 类型不允许），
 * 但 HTTP 层不认类型 —— 所以这里用 `as never` 模拟真实请求体，
 * 直接验证 service 的白名单是最后一道闸。
 */
const databaseUrl = process.env.ORDER_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('菜品写入权限 · PostgreSQL', () => {
  let prisma: PrismaService;
  let dishes: DishesService;
  let ownerMerchant: AuthUser;
  let otherMerchant: AuthUser;
  let student: AuthUser;
  let admin: AuthUser;
  let dishId: string;
  let ownStallId: string;
  let otherStallId: string;
  const cleanup: { userIds: string[]; canteenIds: string[]; stallIds: string[] } = {
    userIds: [], canteenIds: [], stallIds: [],
  };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[a-z][a-z0-9_]*_test(?:_[a-z0-9_]+)?$/i.test(url.pathname)) {
      throw new Error('ORDER_TEST_DATABASE_URL 必须显式指向专用 PostgreSQL 测试库');
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    dishes = new DishesService(prisma);

    const suffix = randomUUID();

    // 两个不同食堂 / 两个档口，用于验证跨档口拒绝
    const canteenA = await prisma.canteen.create({
      data: { name: `测试食堂A-${suffix}`, location: '测试', openTime: '07:00', closeTime: '20:00' },
    });
    const canteenB = await prisma.canteen.create({
      data: { name: `测试食堂B-${suffix}`, location: '测试', openTime: '07:00', closeTime: '20:00' },
    });
    const stallA = await prisma.stall.create({ data: { canteenId: canteenA.id, name: '档口A' } });
    const stallB = await prisma.stall.create({ data: { canteenId: canteenB.id, name: '档口B' } });
    ownStallId = stallA.id;
    otherStallId = stallB.id;
    cleanup.canteenIds.push(canteenA.id, canteenB.id);
    cleanup.stallIds.push(stallA.id, stallB.id);

    const mkUser = async (role: 'MERCHANT' | 'STUDENT' | 'ADMIN', name: string) => {
      const user = await prisma.user.create({
        data: {
          email: `${name}-${randomUUID()}@perm.test`,
          passwordHash: 'x',
          displayName: name,
          role,
        },
      });
      cleanup.userIds.push(user.id);
      return user;
    };

    const m1 = await mkUser('MERCHANT', '商户A');
    const m2 = await mkUser('MERCHANT', '商户B');
    const stu = await mkUser('STUDENT', '学生');
    const adm = await mkUser('ADMIN', '管理员');

    ownerMerchant = { id: m1.id, email: m1.email, role: 'MERCHANT', displayName: m1.displayName, stallIds: [stallA.id] };
    otherMerchant = { id: m2.id, email: m2.email, role: 'MERCHANT', displayName: m2.displayName, stallIds: [stallB.id] };
    student = { id: stu.id, email: stu.email, role: 'STUDENT', displayName: stu.displayName };
    admin = { id: adm.id, email: adm.email, role: 'ADMIN', displayName: adm.displayName };

    const dish = await prisma.dish.create({
      data: { stallId: stallA.id, name: '白名单测试菜', category: '主食', priceCents: 1200 },
    });
    dishId = dish.id;
  });

  afterEach(async () => {
    // 每个用例都可能改名 / 改价，这里恢复到一个已知基线，避免用例相互污染
    await prisma.dish.update({ where: { id: dishId }, data: { name: '白名单测试菜', priceCents: 1200, stallId: ownStallId } });
  });

  afterAll(async () => {
    if (cleanup.stallIds.length) {
      await prisma.dish.deleteMany({ where: { stallId: { in: cleanup.stallIds } } });
    }
    if (cleanup.userIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    if (cleanup.stallIds.length) await prisma.stall.deleteMany({ where: { id: { in: cleanup.stallIds } } });
    if (cleanup.canteenIds.length) await prisma.canteen.deleteMany({ where: { id: { in: cleanup.canteenIds } } });
    await prisma?.$disconnect();
  });

  it('商户可以修改自己档口的菜品', async () => {
    const updated = await dishes.update(ownerMerchant, dishId, { name: '改名后的菜', priceCents: 1500 });
    expect(updated.name).toBe('改名后的菜');
    expect(updated.priceCents).toBe(1500);
  });

  it('跨档口修改返回 403，且数据不变', async () => {
    await expect(dishes.update(otherMerchant, dishId, { name: '劫持' }))
      .rejects.toMatchObject({ status: 403 });
    const after = await prisma.dish.findUnique({ where: { id: dishId } });
    expect(after?.name).toBe('白名单测试菜');
  });

  it('学生调用写接口返回 403', async () => {
    await expect(dishes.update(student, dishId, { name: '学生改的' }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('请求体夹带 stallId 会被丢弃，菜品不会换到别人档口', async () => {
    // 模拟 HTTP 里能传、但 TS 类型不允许的字段
    const payload = { name: '试图换档口', stallId: otherStallId } as never;
    const updated = await dishes.update(ownerMerchant, dishId, payload);
    expect(updated.stallId).toBe(ownStallId);

    const after = await prisma.dish.findUnique({ where: { id: dishId } });
    expect(after?.stallId).toBe(ownStallId);
  });

  it('请求体夹带 avgRating / ratingCount / status 会被丢弃', async () => {
    const before = await prisma.dish.findUnique({ where: { id: dishId } });
    const payload = {
      name: '试图刷分', avgRating: 99, ratingCount: 9999, status: 'OFF_SHELF',
    } as never;
    const updated = await dishes.update(ownerMerchant, dishId, payload);

    expect(updated.name).toBe('试图刷分');
    expect(updated.avgRating).toBe(before?.avgRating);
    expect(updated.ratingCount).toBe(before?.ratingCount);
    expect(updated.status).toBe(before?.status);
  });

  it('管理员可以修改任意档口的菜品', async () => {
    const updated = await dishes.update(admin, dishId, { name: '管理员改的' });
    expect(updated.name).toBe('管理员改的');
  });
});
