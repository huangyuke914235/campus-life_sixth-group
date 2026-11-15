/**
 * 统计：个人饮食报告、商户经营看板、菜品评价分析。
 * 改进建议只在结构化反馈达到阈值时才生成，不在无数据时编造经营结论。
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, ok } from '../common';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async myReport(user: AuthUser) {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const orders = await this.prisma.order.findMany({
      where: { userId: user.id, status: 'COMPLETED' },
      include: { items: true, stall: { include: { canteen: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    const dishCount = new Map<string, number>();
    orders.forEach((o) => o.items.forEach((i) => dishCount.set(i.dishName, (dishCount.get(i.dishName) ?? 0) + 1)));
    const reviews = await this.prisma.review.findMany({
      where: { userId: user.id }, include: { dish: { select: { name: true, category: true } } },
    });
    const thisMonth = orders.filter((o) => o.createdAt >= monthStart);
    return {
      mealsThisMonth: thisMonth.length,
      avgSpendCents: thisMonth.length ? Math.round(thisMonth.reduce((s, o) => s + o.totalCents, 0) / thisMonth.length) : null,
      topDishes: [...dishCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      favoriteCategories: [...new Set(reviews.filter((r) => r.rating >= 4).map((r) => r.dish.category))].slice(0, 5),
      highRatedDishes: reviews.filter((r) => r.rating >= 4).slice(0, 5).map((r) => ({ name: r.dish.name, rating: r.rating })),
      reviewCount: reviews.length,
      note: '营养相关数值为示例估算，非实验室检测结果。',
    };
  }

  /** 商户评价分析：只输出真实统计；建议仅在样本足够时给出。 */
  async merchantReviews(user: AuthUser, dishId?: string) {
    const stallScope = user.role === 'ADMIN' ? {} : { dish: { stallId: { in: user.stallIds ?? [] } } };
    const where = { ...stallScope, ...(dishId ? { dishId } : {}) };
    const [feelings, ratings, recent] = await Promise.all([
      this.prisma.reviewFeeling.groupBy({ by: ['code', 'label'], where: { review: where }, _count: { _all: true } }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      this.prisma.review.findMany({
        where, include: { dish: { select: { name: true } }, user: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' }, take: 20,
      }),
    ]);
    const total = ratings.reduce((s, r) => s + r._count._all, 0);
    const suggestions: string[] = [];
    if (total >= 5) {
      feelings.filter((f) => f._count._all / total >= 0.25).forEach((f) => {
        const map: Record<string, string> = {
          TOO_OILY: '建议复核用油量与烹饪方式', TOO_SALTY: '建议复核调味用盐',
          TOO_SPICY: '建议复核辣度标注与实际出品是否一致', PORTION_SMALL: '建议复核份量标准',
          TOO_BLAND: '建议复核调味浓度',
        };
        if (map[f.code]) suggestions.push(`近 ${total} 条评价中有 ${f._count._all} 条「${f.label}」反馈，${map[f.code]}。`);
      });
    }
    if (total < 5) suggestions.push('样本不足 5 条，暂不自动生成改进结论。');
    return {
      totalReviews: total,
      ratingDistribution: Object.fromEntries(ratings.map((r) => [r.rating, r._count._all])),
      feelingStats: feelings.map((f) => ({ code: f.code, label: f.label, count: f._count._all, ratio: total ? f._count._all / total : 0 })),
      suggestions,
      recentReviews: recent.map((r) => ({ id: r.id, dish: r.dish.name, rating: r.rating, comment: r.comment, status: r.status, createdAt: r.createdAt })),
    };
  }

  async merchantDashboard(user: AuthUser) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const scope = user.role === 'ADMIN' ? {} : { stallId: { in: user.stallIds ?? [] } };
    const [todayOrders, completed, pending, lowStock] = await Promise.all([
      this.prisma.order.findMany({ where: { ...scope, createdAt: { gte: start } }, include: { items: true }, take: 500 }),
      this.prisma.order.count({ where: { ...scope, status: 'COMPLETED', createdAt: { gte: start } } }),
      this.prisma.order.findMany({ where: { ...scope, status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } }, take: 50, orderBy: { createdAt: 'asc' } }),
      this.prisma.inventory.findMany({ where: { date: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), remaining: { lte: 3 } }, include: { dish: { select: { name: true, stallId: true } } }, take: 20 }),
    ]);
    const dishHits = new Map<string, number>();
    todayOrders.forEach((o) => o.items.forEach((i) => dishHits.set(i.dishName, (dishHits.get(i.dishName) ?? 0) + i.quantity)));
    return {
      todayOrderCount: todayOrders.length,
      todayReservationCount: todayOrders.length,
      completedCount: completed,
      simulatedRevenueCents: todayOrders.reduce((s, o) => s + o.totalCents, 0),
      revenueNote: '演示模式订单金额，非真实收款',
      hotDishes: [...dishHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      pendingOrders: pending.length,
      lowStockAlerts: lowStock.filter((i) => user.role === 'ADMIN' || (user.stallIds ?? []).includes(i.dish.stallId))
        .map((i) => ({ dish: i.dish.name, remaining: i.remaining })),
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly s: AnalyticsService) {}
  @Get('my-report') async my(@CurrentUser() u: AuthUser) { return ok(await this.s.myReport(u)); }
  @Get('merchant/reviews') async reviews(@CurrentUser() u: AuthUser, @Query('dishId') dishId?: string) { return ok(await this.s.merchantReviews(u, dishId)); }
  @Get('merchant/dashboard') async dashboard(@CurrentUser() u: AuthUser) { return ok(await this.s.merchantDashboard(u)); }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
