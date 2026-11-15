/** 营养：菜品展示、单餐汇总、历史统计。所有数值必须带来源/估算说明。 */
import { Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { NUTRITION_DISCLAIMER } from '@shiguang/shared';
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
    const since = new Date(Date.now() - days * 86_400_000);
    const orders = await this.prisma.order.findMany({
      where: { userId: user.id, status: 'COMPLETED', createdAt: { gte: since } },
      include: { items: true },
    });
    const dishIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.dishId)))];
    const nutrition = await this.prisma.dishNutrition.findMany({ where: { dishId: { in: dishIds } } });
    const byDish = new Map(nutrition.map((n) => [n.dishId, n]));
    const daily = orders.map((o) => ({
      date: o.createdAt.toISOString().slice(0, 10),
      items: o.items.map((i) => i.dishName),
      totalCents: o.totalCents,
      energyKcal: Math.round(o.items.reduce((s, i) => s + (byDish.get(i.dishId)?.energyKcal ?? 0) * i.quantity, 0)),
      estimated: o.items.some((i) => byDish.get(i.dishId)?.isEstimated ?? true),
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
