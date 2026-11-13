import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { campusDate, campusMealType } from '@shiguang/shared';

export async function withFixtureDb<T>(run: (db: PrismaClient) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://unconfigured');
  const expectedDatabase = process.env.E2E_FIXTURE_DATABASE_NAME;
  if (!expectedDatabase?.endsWith('_test') || url.pathname !== `/${expectedDatabase}`
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('E2E requires an explicitly named local _test database');
  }
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    return await run(db);
  } finally {
    await db.$disconnect();
  }
}

export async function createStudentFlowFixture(project: string) {
  const password = process.env.E2E_DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set a synthetic E2E_DEMO_PASSWORD');
  const passwordHash = await argon2.hash(password);
  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const today = campusDate(now);
  const nextDate = campusDate(new Date(now.getTime() + 86_400_000));
  const mealType = campusMealType(now);
  const date = new Date(`${today}T00:00:00Z`);
  const pickupDate = new Date(`${nextDate}T00:00:00Z`);
  const priceCents = 30000 + Number.parseInt(suffix.slice(0, 4), 16);

  return withFixtureDb((db) => db.$transaction(async (tx) => {
    const canteen = await tx.canteen.create({
      data: { name: `测试食堂 ${project} ${suffix}`, location: '测试楼', openTime: '00:00', closeTime: '23:59' },
    });
    const stall = await tx.stall.create({ data: { name: '测试预约档口', canteenId: canteen.id } });
    const otherStall = await tx.stall.create({ data: { name: '其他测试档口', canteenId: canteen.id } });
    const student = await tx.user.create({
      data: { email: `e2e.student.${suffix}@demo.shiguang.local`, passwordHash, displayName: '流程测试学生', onboardedAt: now },
    });
    const merchant = await tx.user.create({
      data: {
        email: `e2e.merchant.${suffix}@demo.shiguang.local`, passwordHash, displayName: '流程测试商户',
        role: 'MERCHANT', stallAssignments: { connect: { id: stall.id } },
      },
    });
    const dish = await tx.dish.create({
      data: { name: `测试鸡肉饭 ${suffix}`, stallId: stall.id, category: '米饭', priceCents, oilScore: 5 },
    });
    const otherDish = await tx.dish.create({
      data: { name: `其他档口菜品 ${suffix}`, stallId: otherStall.id, category: '米饭', priceCents: 1000 },
    });
    for (const menuDate of [date, pickupDate]) {
      await tx.menu.create({
        data: { stallId: stall.id, date: menuDate, mealType, status: 'PUBLISHED', items: { create: { dishId: dish.id } } },
      });
      await tx.inventory.create({ data: { dishId: dish.id, date: menuDate, mealType, total: 6, remaining: 6 } });
    }
    const slot = await tx.pickupSlot.create({
      data: { stallId: stall.id, date: pickupDate, mealType, startTime: '11:50', endTime: '12:10', capacity: 6 },
    });
    return {
      studentEmail: student.email, merchantEmail: merchant.email, dishId: dish.id, otherDishId: otherDish.id,
      stallId: stall.id, slotId: slot.id, nextDate, pickupDate, mealType, priceCents,
    };
  }));
}
