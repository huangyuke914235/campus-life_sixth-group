/**
 * 统计：个人饮食报告、商户经营看板、菜品评价分析。
 * 改进建议只在结构化反馈达到阈值时才生成，不在无数据时编造经营结论。
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { campusDate, parseCampusDate } from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertStallScope, ok } from '../common';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async myReport(user: AuthUser) {
    const today = campusDate(new Date());
    const completed = { userId: user.id, status: 'COMPLETED' as const };
    const [month, topDishes, reviews, reviewCount] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...completed, scheduledDate: { gte: parseCampusDate(`${today.slice(0, 7)}-01`), lte: parseCampusDate(today) } },
        _count: true, _avg: { totalCents: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['dishName'], where: { order: completed }, _sum: { quantity: true },
        orderBy: [{ _sum: { quantity: 'desc' } }, { dishName: 'asc' }], take: 5,
      }),
      this.prisma.review.findMany({
        where: { userId: user.id, rating: { gte: 8 } },
        select: { rating: true, dish: { select: { name: true, category: true } } },
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }], take: 5,
      }),
      this.prisma.review.count({ where: { userId: user.id } }),
    ]);
    return {
      mealsThisMonth: month._count,
      avgSpendCents: month._avg.totalCents === null ? null : Math.round(month._avg.totalCents),
      topDishes: topDishes.map((d) => ({ name: d.dishName, count: d._sum.quantity ?? 0 })),
      favoriteCategories: [...new Set(reviews.map((r) => r.dish.category))],
      highRatedDishes: reviews.map((r) => ({ name: r.dish.name, rating: r.rating })),
      reviewCount,
      note: '营养相关数值为示例估算，非实验室检测结果。',
    };
  }

  /** 商户评价分析：只输出真实统计；建议仅在样本足够时给出。 */
  async merchantReviews(user: AuthUser, dishId?: string, stallId?: string) {
    const scope = this.stallScope(user, stallId);
    if (dishId) {
      const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, select: { stallId: true } });
      if (!dish) throw Errors.notFound('菜品不存在');
      assertStallScope(user, dish.stallId);
    }
    const where: Prisma.ReviewWhereInput = { dish: scope, ...(dishId ? { dishId } : {}) };
    const [feelings, ratings, recent] = await Promise.all([
      this.prisma.reviewFeeling.groupBy({ by: ['code', 'label'], where: { review: where }, _count: { _all: true } }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
      this.prisma.review.findMany({
        where, include: { dish: { select: { name: true } } },
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

  private stallScope(user: AuthUser, stallId?: string): { stallId?: string | { in: string[] } } {
    if (user.role !== 'ADMIN' && user.role !== 'MERCHANT') throw Errors.forbidden();
    if (stallId) {
      assertStallScope(user, stallId);
      return { stallId };
    }
    return user.role === 'ADMIN' ? {} : { stallId: { in: user.stallIds ?? [] } };
  }

  async merchantDashboard(user: AuthUser, stallId?: string, date = campusDate(new Date())) {
    const day = parseCampusDate(date);
    if (!day) throw Errors.invalidParam('日期不合法');
    const scope = this.stallScope(user, stallId);
    const byDay = { ...scope, scheduledDate: day };
    const [statusGroups, hotDishes, lowStock] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'], where: byDay, _count: true, _sum: { totalCents: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['dishName'], where: { order: { ...byDay, status: 'COMPLETED' } }, _sum: { quantity: true },
        orderBy: [{ _sum: { quantity: 'desc' } }, { dishName: 'asc' }], take: 5,
      }),
      this.prisma.inventory.findMany({
        where: { date: day, remaining: { lte: 3 }, dish: { ...scope, status: 'ACTIVE' } },
        include: { dish: { select: { name: true } } },
        orderBy: [{ remaining: 'asc' }, { id: 'asc' }], take: 20,
      }),
    ]);
    const byStatus = Object.fromEntries(statusGroups.map((group) => [group.status, group._count]));
    const orderCount = statusGroups.reduce((sum, group) => sum + group._count, 0);
    const cancelledCount = byStatus.CANCELLED ?? 0;
    const expiredCount = byStatus.EXPIRED ?? 0;
    const completed = statusGroups.find((group) => group.status === 'COMPLETED');
    return {
      date,
      todayOrderCount: orderCount,
      todayReservationCount: orderCount - cancelledCount - expiredCount,
      completedCount: completed?._count ?? 0,
      cancelledCount, expiredCount,
      simulatedRevenueCents: completed?._sum.totalCents ?? 0,
      revenueNote: '已完成订单的成交金额，不代表线上收款',
      hotDishes: hotDishes.map((d) => ({ name: d.dishName, count: d._sum.quantity ?? 0 })),
      pendingOrders: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'].reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
      lowStockAlerts: lowStock.map((i) => ({ id: i.id, dish: i.dish.name, remaining: i.remaining })),
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly s: AnalyticsService) {}
  @Get('my-report') async my(@CurrentUser() u: AuthUser) { return ok(await this.s.myReport(u)); }
  @Roles('MERCHANT', 'ADMIN') @Get('merchant/reviews') async reviews(
    @CurrentUser() u: AuthUser, @Query('dishId') dishId?: string, @Query('stallId') stallId?: string,
  ) { return ok(await this.s.merchantReviews(u, dishId, stallId)); }
  @Roles('MERCHANT', 'ADMIN') @Get('merchant/dashboard') async dashboard(
    @CurrentUser() u: AuthUser, @Query('stallId') stallId?: string, @Query('date') date?: string,
  ) { return ok(await this.s.merchantDashboard(u, stallId, date)); }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
