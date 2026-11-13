import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BizCode, type AuthUser } from '../common';
import { PreferencesService } from '../preferences/preferences.module';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.module';

const databaseUrl = process.env.REVIEW_TEST_DATABASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('评价与画像 · PostgreSQL', () => {
  let prisma: PrismaService;
  let reviews: ReviewsService;
  let preferences: PreferencesService;
  const fixtures: { canteenId: string; stallId: string; users: string[]; tags: string[] }[] = [];

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[a-z][a-z0-9_]*_test(?:_[a-z0-9_]+)?$/i.test(url.pathname)) {
      throw new Error('REVIEW_TEST_DATABASE_URL 必须显式指向专用 PostgreSQL 测试库');
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    reviews = new ReviewsService(prisma);
    preferences = new PreferencesService(prisma);
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const { canteenId, stallId, users, tags } of fixtures.splice(0)) {
      await prisma.$transaction([
        prisma.review.deleteMany({ where: { userId: { in: users } } }),
        prisma.userBehavior.deleteMany({ where: { userId: { in: users } } }),
        prisma.dish.deleteMany({ where: { stallId } }),
        prisma.dishTag.deleteMany({ where: { name: { in: tags } } }),
        prisma.stall.delete({ where: { id: stallId } }),
        prisma.canteen.delete({ where: { id: canteenId } }),
        prisma.user.deleteMany({ where: { id: { in: users } } }),
      ]);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function fixture() {
    const suffix = randomUUID();
    const canteen = await prisma.canteen.create({
      data: { name: suffix, location: '测试食堂', openTime: '07:00', closeTime: '20:00' },
    });
    const stall = await prisma.stall.create({ data: { canteenId: canteen.id, name: '测试档口' } });
    const record = { canteenId: canteen.id, stallId: stall.id, users: [] as string[], tags: [] as string[] };
    fixtures.push(record);

    async function student(name: string): Promise<AuthUser> {
      const row = await prisma.user.create({
        data: { email: name + '.' + suffix + '@example.invalid', displayName: name, passwordHash: 'fixture' },
      });
      record.users.push(row.id);
      return { id: row.id, email: row.email, displayName: row.displayName, role: 'STUDENT' };
    }

    async function dish(name: string) {
      const tag = name + '-' + suffix;
      const row = await prisma.dish.create({
        data: {
          stallId: stall.id, name, category: '米饭', priceCents: 1200,
          tags: { create: { name: tag, category: 'FLAVOR' } },
        },
      });
      record.tags.push(tag);
      return { id: row.id, tag };
    }

    return { student, dish };
  }

  it('同一学生并发提交六条线下补评，仅前三条可写入', async () => {
    const f = await fixture();
    const user = await f.student('limit');
    const dishes = await Promise.all(Array.from({ length: 6 }, (_, index) => f.dish('菜品' + index)));
    const attempts = await Promise.allSettled(dishes.map((dish) => reviews.create(user, { dishId: dish.id, rating: 8 })));
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(3);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ bizCode: BizCode.INVALID_PARAM });
    }
    expect(await prisma.review.count({ where: { userId: user.id, source: 'OFFLINE' } })).toBe(3);
    expect(await prisma.userTasteProfile.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      feedbackCount: 3,
    });
  }, 20_000);

  it('同一菜品的并发写入、修改和删除均保留正确统计', async () => {
    const f = await fixture();
    const [first, second, dish] = await Promise.all([f.student('first'), f.student('second'), f.dish('测试盖饭')]);
    const [low, high] = await Promise.all([
      reviews.create(first, { dishId: dish.id, rating: 2 }),
      reviews.create(second, { dishId: dish.id, rating: 10 }),
    ]);
    expect(await prisma.dish.findUniqueOrThrow({ where: { id: dish.id } })).toMatchObject({
      avgRating: 6, ratingCount: 2, verifiedRatingCount: 0,
    });
    await Promise.all([
      reviews.update(first, low.reviewId, { rating: 7 }),
      reviews.remove(second, high.reviewId),
    ]);
    expect(await prisma.dish.findUniqueOrThrow({ where: { id: dish.id } })).toMatchObject({
      avgRating: 7, ratingCount: 1, verifiedRatingCount: 0,
    });
    expect(await prisma.userTasteProfile.findUniqueOrThrow({ where: { userId: second.id } })).toMatchObject({
      feedbackCount: 0, tagWeights: {},
    });
  });

  it('重置画像后修改旧评价与提交新评价只重放新信号', async () => {
    const f = await fixture();
    const [user, priorDish, laterDish] = await Promise.all([f.student('reset'), f.dish('旧菜'), f.dish('新菜')]);
    await preferences.save(user, { ingredientLikes: ['米饭'] });
    await preferences.addRestriction(user, { kind: 'DISLIKE', value: '香菜' });
    const old = await reviews.create(user, { dishId: priorDish.id, rating: 10, feelings: ['TOO_OILY'] });
    const original = await prisma.userTasteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(original.tagWeights).toHaveProperty(priorDish.tag);
    expect(original.feedbackCount).toBe(1);

    // 显式分开数据库生成的评价时间和 API 记录的重置时刻。
    const now = Date.now();
    const resetAt = new Date(now - 60_000);
    await prisma.review.update({ where: { id: old.reviewId }, data: { createdAt: new Date(now - 120_000) } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(resetAt);
    try {
      await preferences.resetInferred(user);
    } finally {
      vi.useRealTimers();
    }
    await reviews.update(user, old.reviewId, { rating: 2, feelings: ['FELT_GREASY'] });
    expect(await prisma.userTasteProfile.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      resetAt, feedbackCount: 0, tagWeights: {},
    });

    await reviews.create(user, { dishId: laterDish.id, rating: 10, feelings: ['JUST_RIGHT'] });
    const rebuilt = await prisma.userTasteProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(rebuilt).toMatchObject({ resetAt, feedbackCount: 1 });
    expect(rebuilt.tagWeights).toHaveProperty(laterDish.tag);
    expect(rebuilt.tagWeights).not.toHaveProperty(priorDish.tag);
    expect(await preferences.profile(user)).toMatchObject({
      explicit: { ingredientLikes: ['米饭'] },
      restrictions: [{ kind: 'DISLIKE', value: '香菜', source: 'USER_EXPLICIT' }],
      reviewCount: 2,
    });
  });
});
