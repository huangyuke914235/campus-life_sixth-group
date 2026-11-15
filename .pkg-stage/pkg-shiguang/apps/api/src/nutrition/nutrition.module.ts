/** 营养：菜品展示、单餐汇总、历史统计。所有数值必须带来源/估算说明。 */
import { Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { campusDate, parseCampusDate, NUTRITION_DISCLAIMER } from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, ok } from '../common';

class MealSummaryDto {
  @IsArray() @IsString({ each: true }) dishIds!: string[];
}

@Injectable()
export class NutritionService {
  constructor(private readonly prisma: PrismaService) {}

  async dish(id: string) {
    const row = await this.prisma.dishNutrition.findUnique({ where: { dishId: id }, include: { dish: { select: { name: true } } } });
    if (!row) throw Errors.notFound('该菜品暂无营养信息');
    return { ...row, disclaimer: NUTRITION_DISCLAIMER };
  }

  async mealSummary(dto: MealSummaryDto) {
    const rows = await this.prisma.dishNutrition.findMany({ where: { dishId: { in: dto.dishIds } } });
    const sum = rows.reduce((acc, r) => ({
      energyKcal: acc.energyKcal + r.energyKcal,
      proteinG: acc.proteinG + r.proteinG,
      fatG: acc.fatG + r.fatG,
      carbG: acc.carbG + r.carbG,
      fiberG: acc.fiberG + (r.fiberG ?? 0),
      sodiumMg: acc.sodiumMg + (r.sodiumMg ?? 0),
    }), { energyKcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, sodiumMg: 0 });
    const macroKcal = sum.proteinG * 4 + sum.carbG * 4 + sum.fatG * 9;
    return {
      ...sum,
      macroRatio: macroKcal > 0 ? {
        protein: Math.round((sum.proteinG * 4 / macroKcal) * 100),
        carb: Math.round((sum.carbG * 4 / macroKcal) * 100),
        fat: Math.round((sum.fatG * 9 / macroKcal) * 100),
      } : null,
      coveredDishes: rows.length,
      missingDishes: dto.dishIds.length - rows.length,
      allEstimated: rows.every((r) => r.isEstimated),
      disclaimer: NUTRITION_DISCLAIMER,
    };
  }

  async history(user: AuthUser, days = 30) {
    const today = parseCampusDate(campusDate(new Date()))!;
    const since = new Date(today);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const orders = await this.prisma.order.findMany({
      where: { userId: user.id, status: 'COMPLETED', scheduledDate: { gte: since, lte: today } },
      select: { scheduledDate: true, totalCents: true, items: { select: { dishId: true, dishName: true, quantity: true } } },
      orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
    });
    const dishIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.dishId)))];
    const nutrition = await this.prisma.dishNutrition.findMany({ where: { dishId: { in: dishIds } } });
    const byDish = new Map(nutrition.map((n) => [n.dishId, n]));
    const byDate = new Map<string, {
      items: Set<string>; totalCents: number; energyKcal: number; estimated: boolean;
      completedCount: number; knownServings: number; missingServings: number;
    }>();
    for (const order of orders) {
      const date = order.scheduledDate.toISOString().slice(0, 10);
      const day = byDate.get(date) ?? {
        items: new Set<string>(), totalCents: 0, energyKcal: 0, estimated: false,
        completedCount: 0, knownServings: 0, missingServings: 0,
      };
      day.totalCents += order.totalCents;
      day.completedCount += 1;
      for (const item of order.items) {
        day.items.add(item.dishName);
        const info = byDish.get(item.dishId);
        if (info) {
          day.energyKcal += info.energyKcal * item.quantity;
          day.estimated ||= info.isEstimated;
          day.knownServings += item.quantity;
        } else {
          day.missingServings += item.quantity;
        }
      }
      byDate.set(date, day);
    }
    const daily = [...byDate].map(([date, day]) => ({
      ...day, date, items: [...day.items], energyKcal: day.knownServings ? Math.round(day.energyKcal) : null,
    }));
    return { days, daily, disclaimer: NUTRITION_DISCLAIMER };
  }
}

@Controller('nutrition')
export class NutritionController {
  constructor(private readonly s: NutritionService) {}
  @Get('dishes/:dishId') async dish(@Param('dishId') id: string) { return ok(await this.s.dish(id)); }
  @Post('meal-summary') async meal(@Body() d: MealSummaryDto) { return ok(await this.s.mealSummary(d)); }
  @Get('history') async history(@CurrentUser() u: AuthUser) { return ok(await this.s.history(u)); }
}

@Module({ controllers: [NutritionController], providers: [NutritionService] })
export class NutritionModule {}
