/**
 * 推荐模块：把真实数据库里的菜单、画像、评价、行为喂给本地混合推荐引擎，
 * 落 RecommendationLog，并把可解释理由返回给前端。
 * 默认不依赖任何外部 AI API；RECO_PROVIDER=local 为出厂配置。
 */
import { Body, Controller, Get, Injectable, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { Request } from 'express';
import {
  DEFAULT_WEIGHTS, MEAL_STYLE_LABELS, RECO_DEFAULTS, composeSetMeal, emptyTasteProfile,
  normalizeWeights, recommend,
  type BehaviorSignal, type DishCandidate, type FeedbackSignal, type MealStyle, type MealType,
  type RecommendationContext, type RecommendationWeights, type TasteProfile,
  type UserPreference,
} from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertOwnerOrAdmin, ok } from '../common';

const DEFAULT_PREFERENCE: UserPreference = {
  cuisines: [], staplePreferences: [], ingredientLikes: [], ingredientDislikes: [],
  spiceTolerance: 1, sweetness: 2, saltiness: 2, oilTolerance: 3, flavorIntensity: 2,
  specialLikes: [], budgetMinCents: 1000, budgetMaxCents: 3000,
  preferredCanteenIds: [], preferredStallIds: [], usualMealTimes: [],
  priority: 'TASTE', adventurous: false, dietPattern: 'OMNIVORE',
};

class QueryDto {
  @IsOptional() @IsString() mealType?: string;
  @IsOptional() @IsInt() @Min(0) budgetMinCents?: number;
  @IsOptional() @IsInt() @Min(0) budgetMaxCents?: number;
  @IsOptional() @IsBoolean() wantSpicy?: boolean;
  @IsOptional() @IsBoolean() wantLight?: boolean;
  @IsOptional() @IsBoolean() wantNew?: boolean;
  @IsOptional() @IsBoolean() highProtein?: boolean;
  @IsOptional() @IsBoolean() wantValue?: boolean;
  @IsOptional() @IsBoolean() wantSoup?: boolean;
  @IsOptional() @IsArray() canteenIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(10) limit?: number;
}

class SetMealDto {
  @IsOptional() @IsString() mealType?: string;
  @IsOptional() @IsString() style?: string;
  @IsOptional() @IsInt() @Min(500) @Max(20000) budgetCents?: number;
}

class WeightDto implements Partial<RecommendationWeights> {  @IsOptional() @Min(0) @Max(1) taste?: number;
  @IsOptional() @Min(0) @Max(1) diet?: number;
  @IsOptional() @Min(0) @Max(1) feedback?: number;
  @IsOptional() @Min(0) @Max(1) dishQuality?: number;
  @IsOptional() @Min(0) @Max(1) budget?: number;
  @IsOptional() @Min(0) @Max(1) mealSupply?: number;
  @IsOptional() @Min(0) @Max(1) diversity?: number;
}

@Injectable()
export class RecommendationService {
  /** 运行时权重覆盖（管理员可改）；生产应迁移到配置表，此处保证无数据库迁移也能运行。 */
  private weightOverride: Partial<RecommendationWeights> | undefined;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async loadPreference(userId: string): Promise<UserPreference> {
    const p = await this.prisma.userPreference.findUnique({ where: { userId } });
    if (!p) return { ...DEFAULT_PREFERENCE };
    return {
      cuisines: p.cuisines, staplePreferences: p.staplePreferences,
      ingredientLikes: p.ingredientLikes, ingredientDislikes: p.ingredientDislikes,
      spiceTolerance: p.spiceTolerance, sweetness: p.sweetness, saltiness: p.saltiness,
      oilTolerance: p.oilTolerance, flavorIntensity: p.flavorIntensity, specialLikes: p.specialLikes,
      budgetMinCents: p.budgetMinCents, budgetMaxCents: p.budgetMaxCents,
      preferredCanteenIds: p.preferredCanteenIds, preferredStallIds: p.preferredStallIds,
      usualMealTimes: p.usualMealTimes, priority: p.priority as UserPreference['priority'],
      adventurous: p.adventurous, dietPattern: p.dietPattern,
    };
  }

  private async loadTasteProfile(userId: string, now: string): Promise<TasteProfile> {
    const p = await this.prisma.userTasteProfile.findUnique({ where: { userId } });
    if (!p) return emptyTasteProfile(now);
    return {
      tagWeights: (p.tagWeights as Record<string, number>) ?? {},
      oilToleranceInferred: p.oilToleranceInferred,
      spiceAffinity: p.spiceAffinity,
      saltSensitivity: p.saltSensitivity,
      vegetableAffinity: p.vegetableAffinity,
      proteinAffinity: p.proteinAffinity,
      flavorIntensity: p.flavorIntensity,
      portionPreference: p.portionPreference,
      noveltyAffinity: p.noveltyAffinity,
      confidence: p.confidence,
      feedbackCount: p.feedbackCount,
      lastDecayAt: p.lastDecayAt.toISOString(),
    };
  }

  /** 候选集 = 当日该餐次已发布菜单中仍可点的菜，并带上真实库存。 */
  private async loadCandidates(date: string, mealType: MealType): Promise<DishCandidate[]> {
    const rows = await this.prisma.menuItem.findMany({
      where: {
        isAvailable: true,
        menu: { date: new Date(`${date}T00:00:00Z`), mealType, status: 'PUBLISHED' },
        dish: { status: 'ACTIVE' },
      },
      include: {
        dish: { include: { tags: true, stall: true, ingredientRows: true, nutrition: true } },
        menu: true,
      },
      take: 300,
    });
    if (rows.length === 0) return [];

    const dishIds = [...new Set(rows.map((r) => r.dishId))];
    const inventories = await this.prisma.inventory.findMany({
      where: { dishId: { in: dishIds }, date: new Date(`${date}T00:00:00Z`), mealType },
    });
    const invMap = new Map(inventories.map((i) => [i.dishId, i.remaining]));

    return rows.map(({ dish }) => ({
      id: dish.id,
      name: dish.name,
      priceCents: dish.priceCents,
      category: dish.category,
      cuisine: dish.cuisine ?? undefined,
      tags: dish.tags.map((t) => t.name),
      ingredients: dish.ingredientRows.map((i) => i.name),
      spiceScore: dish.spiceScore,
      oilScore: dish.oilScore,
      saltScore: dish.saltScore,
      sweetnessScore: dish.sweetnessScore,
      flavorIntensity: dish.flavorIntensity,
      portionScore: dish.portionScore,
      allergens: dish.allergens,
      isVegetarian: dish.isVegetarian,
      isHighProtein: dish.isHighProtein,
      isNew: dish.isNew,
      avgRating: dish.avgRating,
      ratingCount: dish.ratingCount,
      isAvailable: dish.status === 'ACTIVE',
      stockRemaining: invMap.get(dish.id) ?? 0,
      availableMealTypes: [mealType],
      canteenId: dish.stall.canteenId,
      stallId: dish.stallId,
      stallName: dish.stall.name,
      createdAt: dish.createdAt.toISOString(),
      nutrition: dish.nutrition
        ? {
            energyKcal: dish.nutrition.energyKcal,
            proteinG: dish.nutrition.proteinG,
            fatG: dish.nutrition.fatG,
            carbG: dish.nutrition.carbG,
            isEstimated: dish.nutrition.isEstimated,
          }
        : null,
    }));
  }

  private async loadFeedbacks(userId: string): Promise<FeedbackSignal[]> {
    const reviews = await this.prisma.review.findMany({
      where: { userId, status: { not: 'HIDDEN' } },
      include: { feelings: true, dish: { include: { tags: true, ingredientRows: true } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return reviews.map((r) => ({
      dishId: r.dishId,
      rating: r.rating,
      feelings: r.feelings.map((f) => f.code),
      source: r.source as FeedbackSignal['source'],
      createdAt: r.createdAt.toISOString(),
      dishTags: r.dish.tags.map((t) => t.name),
      dishIngredients: r.dish.ingredientRows.map((i) => i.name),
    }));
  }

  private async loadBehaviors(userId: string): Promise<BehaviorSignal[]> {
    const rows = await this.prisma.userBehavior.findMany({
      where: { userId, type: { in: ['FAVORITE_ADD', 'FAVORITE_REMOVE', 'ORDER_CREATE', 'ORDER_CANCEL', 'RECO_DISLIKE', 'VIEW_DISH'] } },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    return rows.map((b) => ({
      dishId: b.dishId ?? undefined,
      type: b.type as BehaviorSignal['type'],
      createdAt: b.createdAt.toISOString(),
      dishTags: ((b.payload as { dishTags?: string[] } | null)?.dishTags) ?? [],
    }));
  }

  async generate(userId: string, dto: QueryDto, req?: Request) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const mealType = (dto.mealType as MealType) || inferMealType(now);
    const preference = await this.loadPreference(userId);
    const restrictions = (await this.prisma.dietaryRestriction.findMany({ where: { userId } }))
      .map((r) => ({ kind: r.kind as never, value: r.value, source: r.source as never }));
    const tasteProfile = await this.loadTasteProfile(userId, now.toISOString());
    const feedbacks = await this.loadFeedbacks(userId);
    const behaviors = await this.loadBehaviors(userId);
    const dishes = await this.loadCandidates(date, mealType);

    const recentLogs = await this.prisma.recommendationItem.findMany({
      where: { log: { userId }, createdAt: { gte: new Date(now.getTime() - RECO_DEFAULTS.maxRepeatDays * 86_400_000) } },
      select: { dishId: true }, take: 100,
    });

    const context: RecommendationContext = {
      mealType, date,
      budgetMinCents: dto.budgetMinCents ?? preference.budgetMinCents,
      budgetMaxCents: dto.budgetMaxCents ?? preference.budgetMaxCents,
      preferredCanteenIds: dto.canteenIds ?? preference.preferredCanteenIds,
      wantSpicy: dto.wantSpicy, wantLight: dto.wantLight, wantNew: dto.wantNew,
      highProtein: dto.highProtein, wantValue: dto.wantValue, wantSoup: dto.wantSoup,
      limit: dto.limit ?? RECO_DEFAULTS.maxResults,
      now: now.toISOString(),
      recentRecommendedDishIds: [...new Set(recentLogs.map((r) => r.dishId))],
    };

    const weights = normalizeWeights(this.weightOverride ?? envWeights(this.config));
    const result = recommend({ dishes, preference, restrictions, tasteProfile, feedbacks, behaviors, context, weights });

    // 推荐行为落到数据库，便于后续分析与算法升级
    const log = await this.prisma.recommendationLog.create({
      data: {
        userId,
        context: context as unknown as object,
        algorithm: result.algorithm,
        weights: result.weights as unknown as object,
        explanation: result.items.map((i) => ({ dishId: i.dish.id, reason: i.reason })) as unknown as object,
        items: {
          create: result.items.map((i) => ({
            dishId: i.dish.id, rank: i.rank, score: i.score,
            scoreParts: i.scoreParts as unknown as object, reason: i.reason,
          })),
        },
      },
    });
    await this.prisma.userBehavior.create({
      data: { userId, type: 'RECO_SHOWN', payload: { logId: log.id, count: result.items.length } },
    });

    return {
      logId: log.id,
      mealType, date,
      coldStart: result.coldStart,
      algorithm: result.algorithm,
      weights: result.weights,
      items: result.items.map((i) => ({
        dishId: i.dish.id, name: i.dish.name, priceCents: i.dish.priceCents,
        imageUrl: undefined as string | undefined,
        canteenId: i.dish.canteenId, stallId: i.dish.stallId,
        score: i.score, scoreParts: i.scoreParts, reason: i.reason,
        matchedTags: i.matchedTags, rank: i.rank,
        /** 匹配度仅为估算排序结果，不是经过科学验证的概率 */
        matchNote: '匹配度为算法估算排序结果，非精确概率',
      })),
      rejectedCount: result.rejected.length,
      rejected: result.rejected,
    };
  }

  /** 一键搭配：主食 / 蛋白 / 蔬菜 / 汤饮各挑一道，按整餐预算控制总价。 */
  async setMeal(userId: string, dto: SetMealDto) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const mealType = (dto.mealType as MealType) || inferMealType(now);
    const [preference, restrictionRows, tasteProfile, feedbacks, behaviors, dishes] = await Promise.all([
      this.loadPreference(userId),
      this.prisma.dietaryRestriction.findMany({ where: { userId } }),
      this.loadTasteProfile(userId, now.toISOString()),
      this.loadFeedbacks(userId),
      this.loadBehaviors(userId),
      this.loadCandidates(date, mealType),
    ]);
    const restrictions = restrictionRows.map((r) => ({
      kind: r.kind as never, value: r.value, source: r.source as never,
    }));
    const budgetCents = dto.budgetCents ?? 2500;
    const context: RecommendationContext = {
      mealType, date,
      budgetMinCents: preference.budgetMinCents,
      budgetMaxCents: budgetCents,
      limit: 80,
      now: now.toISOString(),
      recentRecommendedDishIds: [],
    };
    const weights = normalizeWeights(this.weightOverride ?? envWeights(this.config));
    const result = composeSetMeal({
      dishes, preference, restrictions, tasteProfile, feedbacks, behaviors, context, weights,
      style: (dto.style as MealStyle) || 'BALANCED',
      budgetCents,
    });

    const log = await this.prisma.recommendationLog.create({
      data: {
        userId,
        context: { mealType, date, style: result.style, budgetCents, mode: 'set-meal' } as unknown as object,
        algorithm: result.algorithm,
        weights: weights as unknown as object,
        explanation: result.slots.map((s) => ({ dishId: s.dish.id, role: s.role, reason: s.reason })) as unknown as object,
        items: {
          create: result.slots.map((s, i) => ({
            dishId: s.dish.id, rank: i + 1, score: s.score,
            scoreParts: {} as unknown as object, reason: s.reason,
          })),
        },
      },
    });

    return {
      logId: log.id,
      style: result.style,
      styleLabel: MEAL_STYLE_LABELS[result.style],
      summary: result.summary,
      totalCents: result.totalCents,
      budgetCents,
      overBudget: result.overBudget,
      missingRoles: result.missingRoles,
      nutrition: result.nutrition,
      slots: result.slots.map((s) => ({
        role: s.role,
        roles: s.roles,
        dishId: s.dish.id,
        name: s.dish.name,
        priceCents: s.dish.priceCents,
        canteenId: s.dish.canteenId,
        stallId: s.dish.stallId,
        stallName: s.dish.stallName ?? '',
        score: s.score,
        reason: s.reason,
      })),
      rejectedCount: result.rejected.length,
      disclaimer: '营养合计为估算值；搭配结果为算法推荐，不是营养处方。',
    };
  }

  async explain(userId: string, dishId: string) {
    const item = await this.prisma.recommendationItem.findFirst({
      where: { dishId, log: { userId } },
      orderBy: { createdAt: 'desc' },
      include: { log: true },
    });
    if (!item) throw Errors.notFound('暂无该菜品的推荐记录');
    return {
      dishId, reason: item.reason, score: item.score,
      scoreParts: item.scoreParts, weights: item.log.weights,
      algorithm: item.log.algorithm, generatedAt: item.log.createdAt,
    };
  }

  async dislike(userId: string, dishId: string) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, include: { tags: true } });
    if (!dish) throw Errors.notFound('菜品不存在');
    await this.prisma.userBehavior.create({
      data: { userId, dishId, type: 'RECO_DISLIKE', payload: { dishTags: dish.tags.map((t) => t.name) } },
    });
    await this.prisma.recommendationItem.updateMany({
      where: { dishId, log: { userId } }, data: { wasDisliked: true },
    });
    return { recorded: true, note: '已记录，下次推荐会降低相似菜品权重' };
  }

  async getWeights() {
    return { effective: normalizeWeights(this.weightOverride ?? envWeights(this.config)), defaults: DEFAULT_WEIGHTS, source: this.weightOverride ? 'runtime' : 'env' };
  }

  async setWeights(actor: AuthUser, dto: WeightDto) {
    this.weightOverride = { ...this.weightOverride, ...dto };
    const normalized = normalizeWeights(this.weightOverride);
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, actorRole: actor.role, action: 'RECO_WEIGHTS_UPDATE', targetType: 'RecommendationConfig', metadata: normalized as unknown as object },
    });
    return normalized;
  }
}

function envWeights(config: ConfigService): Partial<RecommendationWeights> {
  const n = (key: string): number | undefined => {
    const raw = config.get<string>(key);
    return raw === undefined ? undefined : Number(raw);
  };
  return {
    taste: n('RECO_WEIGHT_TASTE'), diet: n('RECO_WEIGHT_DIET'), feedback: n('RECO_WEIGHT_FEEDBACK'),
    dishQuality: n('RECO_WEIGHT_DISH_QUALITY'), budget: n('RECO_WEIGHT_BUDGET'),
    mealSupply: n('RECO_WEIGHT_MEAL_SUPPLY'), diversity: n('RECO_WEIGHT_DIVERSITY'),
  };
}

function inferMealType(d: Date): MealType {
  const h = d.getUTCHours() + 8; // 北京时间
  if (h < 10) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  return 'DINNER';
}

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly service: RecommendationService) {}

  @Get('today')
  async today(@CurrentUser() user: AuthUser) {
    return ok(await this.service.generate(user.id, {}));
  }

  @Post('query')
  async query(@CurrentUser() user: AuthUser, @Body() dto: QueryDto) {
    return ok(await this.service.generate(user.id, dto));
  }

  /** 一键搭配：给不想挑菜的用户一份完整组合 */
  @Post('set-meal')
  async setMeal(@CurrentUser() user: AuthUser, @Body() dto: SetMealDto) {
    return ok(await this.service.setMeal(user.id, dto));
  }

  @Get('explain/:dishId')
  async explain(@CurrentUser() user: AuthUser, @Param('dishId') dishId: string) {
    return ok(await this.service.explain(user.id, dishId));
  }

  @Post('dislike/:dishId')
  async dislike(@CurrentUser() user: AuthUser, @Param('dishId') dishId: string) {
    return ok(await this.service.dislike(user.id, dishId));
  }

  @Get('config')
  async config() { return ok(await this.service.getWeights()); }

  @Roles('ADMIN')
  @Put('config')
  async updateConfig(@CurrentUser() user: AuthUser, @Body() dto: WeightDto) {
    return ok(await this.service.setWeights(user, dto));
  }
}

@Module({
  controllers: [RecommendationsController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationsModule {}
