/**
 * 饭后评价模块 —— 五星评分 + 结构化体感标签 + 可选短评。
 *
 * 一致性策略：任何新增 / 修改 / 删除评价后
 *   1) 在事务内重算菜品均分（区分已核验订单）
 *   2) 基于该用户「剩余的全部评价」重放画像更新，而不是做增量补丁
 * 这样删除或修改不会留下漂移的画像，推荐结果最终一致。
 * 管理员隐藏评价只影响展示，不删除记录、不改动统计与画像。
 */
import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import {
  FEELING_BY_CODE, FEELING_OPTIONS, RECO_DEFAULTS, emptyTasteProfile, updateTasteProfile,
  type TasteProfile,
} from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, assertOwnerOrAdmin, ok, paged } from '../common';

const BLOCK_WORDS = ['广告', '加微信', '代刷', '刷单', '博彩'];

function sanitizeComment(input?: string): string | undefined {
  if (input === undefined || input === null) return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > RECO_DEFAULTS.maxCommentLength) throw Errors.invalidParam('短评最多 120 字');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) throw Errors.contentRejected('包含不可见控制字符');
  const stripped = trimmed.replace(/<[^>]*>/g, '').trim();
  if (BLOCK_WORDS.some((w) => stripped.includes(w))) throw Errors.contentRejected('内容未通过基础审核');
  return stripped;
}

function validateFeelings(codes: string[]): { group: string; code: string; label: string }[] {
  const unique = [...new Set(codes)];
  const overall = unique.filter((c) => FEELING_BY_CODE[c]?.group === 'OVERALL');
  if (overall.length > 1) throw Errors.invalidParam('整体感受只能选一项');
  const out: { group: string; code: string; label: string }[] = [];
  for (const code of unique) {
    const option = FEELING_BY_CODE[code];
    if (!option) throw Errors.invalidParam(`未知的体感标签：${code}`);
    out.push({ group: option.group, code, label: option.label });
  }
  return out;
}

class CreateReviewDto {
  @IsString() dishId!: string;
  @IsOptional() @IsString() orderItemId?: string;
  @IsInt() @Min(1) @Max(10) rating!: number;
  @IsOptional() @IsArray() feelings?: string[];
  @IsOptional() @IsString() @MaxLength(120) comment?: string;
}

class UpdateReviewDto {
  @IsOptional() @IsInt() @Min(1) @Max(10) rating?: number;
  @IsOptional() @IsArray() feelings?: string[];
  @IsOptional() @IsString() @MaxLength(120) comment?: string;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 均分始终基于真实评价重算；隐藏只影响展示层。 */
  private async recomputeDishRating(tx: Prisma.TransactionClient, dishId: string): Promise<void> {
    const [agg, verified] = await Promise.all([
      tx.review.aggregate({ where: { dishId }, _avg: { rating: true }, _count: { _all: true } }),
      tx.review.count({ where: { dishId, source: 'VERIFIED_ORDER' } }),
    ]);
    await tx.dish.update({
      where: { id: dishId },
      data: {
        avgRating: agg._avg.rating ?? 0,
        ratingCount: agg._count._all,
        verifiedRatingCount: verified,
      },
    });
  }

  /**
   * 从全部现存评价重放画像：平滑更新 + 时间衰减 + 置信度都由 shared 引擎负责。
   * 修改 / 删除评价后调用，杜绝增量补丁导致的不一致。
   */
  private async rebuildTasteProfile(tx: Prisma.TransactionClient, userId: string): Promise<TasteProfile> {
    const reviews = await tx.review.findMany({
      where: { userId },
      include: { feelings: true, dish: { include: { tags: true, ingredientRows: true } } },
      orderBy: { createdAt: 'asc' },
    });
    let profile = emptyTasteProfile(new Date().toISOString());
    for (const r of reviews) {
      profile = updateTasteProfile(profile, {
        rating: r.rating,
        feelings: r.feelings.map((f) => f.code),
        dishTags: r.dish.tags.map((t) => t.name),
        dishIngredients: r.dish.ingredientRows.map((i) => i.name),
        source: r.source as 'VERIFIED_ORDER' | 'OFFLINE',
        createdAt: r.createdAt.toISOString(),
      });
    }
    await tx.userTasteProfile.upsert({
      where: { userId },
      create: {
        userId,
        tagWeights: profile.tagWeights as unknown as object,
        oilToleranceInferred: profile.oilToleranceInferred,
        spiceAffinity: profile.spiceAffinity,
        saltSensitivity: profile.saltSensitivity,
        flavorIntensity: profile.flavorIntensity,
        portionPreference: profile.portionPreference,
        vegetableAffinity: profile.vegetableAffinity,
        proteinAffinity: profile.proteinAffinity,
        noveltyAffinity: profile.noveltyAffinity,
        confidence: profile.confidence,
        feedbackCount: profile.feedbackCount,
        lastDecayAt: new Date(profile.lastDecayAt),
      },
      update: {
        tagWeights: profile.tagWeights as unknown as object,
        oilToleranceInferred: profile.oilToleranceInferred,
        spiceAffinity: profile.spiceAffinity,
        saltSensitivity: profile.saltSensitivity,
        flavorIntensity: profile.flavorIntensity,
        portionPreference: profile.portionPreference,
        vegetableAffinity: profile.vegetableAffinity,
        proteinAffinity: profile.proteinAffinity,
        noveltyAffinity: profile.noveltyAffinity,
        confidence: profile.confidence,
        feedbackCount: profile.feedbackCount,
        lastDecayAt: new Date(profile.lastDecayAt),
      },
    });
    return profile;
  }

  async create(user: AuthUser, dto: CreateReviewDto) {
    const comment = sanitizeComment(dto.comment);
    const feelings = validateFeelings(dto.feelings ?? []);
    const dish = await this.prisma.dish.findUnique({ where: { id: dto.dishId } });
    if (!dish) throw Errors.notFound('菜品不存在');

    let orderId: string | null = null;
    let source: 'VERIFIED_ORDER' | 'OFFLINE' = 'OFFLINE';
    if (dto.orderItemId) {
      const item = await this.prisma.orderItem.findUnique({
        where: { id: dto.orderItemId }, include: { order: true },
      });
      if (!item) throw Errors.notFound('订单明细不存在');
      if (item.order.userId !== user.id) throw Errors.forbidden('无权评价他人订单');
      if (item.dishId !== dto.dishId) throw Errors.invalidParam('订单明细与菜品不一致');
      if (item.order.status !== 'COMPLETED') throw Errors.invalidParam('订单完成后才能评价');
      orderId = item.orderId;
      source = 'VERIFIED_ORDER';
    } else {
      // 线下补评限频：24 小时内最多 3 条，且不计入已核验评分
      const since = new Date(Date.now() - 86_400_000);
      const recent = await this.prisma.review.count({ where: { userId: user.id, source: 'OFFLINE', createdAt: { gte: since } } });
      if (recent >= 3) throw Errors.invalidParam('线下补评过于频繁，请稍后再试');
    }

    // 已核验订单：同一订单同一菜品只能评一次（数据库唯一约束兜底）
    // 线下补评：允许不同时间再次评价，靠 24 小时 ≤3 条的频率限制防刷
    const duplicate = orderId
      ? await this.prisma.review.findFirst({ where: { userId: user.id, dishId: dto.dishId, orderId } })
      : null;
    if (duplicate) throw Errors.duplicateReview();

    const result = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          userId: user.id, dishId: dto.dishId, orderId, orderItemId: dto.orderItemId ?? null,
          source, rating: dto.rating, comment: comment ?? null,
          feelings: { create: feelings.map((f) => ({ group: f.group as never, code: f.code, label: f.label })) },
        },
        include: { feelings: true },
      });
      await this.recomputeDishRating(tx, dto.dishId);
      const profile = await this.rebuildTasteProfile(tx, user.id);
      await tx.userBehavior.create({
        data: { userId: user.id, dishId: dto.dishId, type: 'REVIEW_SUBMIT', payload: { reviewId: review.id, rating: dto.rating } },
      });
      return { review, profile };
    });

    const oily = feelings.some((f) => f.code === 'TOO_OILY' || f.code === 'FELT_GREASY');
    return {
      reviewId: result.review.id,
      rating: dto.rating,
      feelings: result.review.feelings.map((f) => f.code),
      source,
      message: '评价已记录，食光会更懂你的口味。',
      algorithmNote: oily
        ? '已适当降低高油腻度相似菜品的推荐权重。'
        : (dto.rating <= 2 ? '已适当降低相似菜品的推荐权重。' : '相似菜品的推荐权重会小幅提升。'),
      profileConfidence: result.profile.confidence,
      disclaimer: '主观体感不构成医学判断；图中数值为算法排序结果而非精确概率。',
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateReviewDto) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('评价不存在');
    assertOwnerOrAdmin(user, existing.userId);
    const comment = dto.comment === undefined ? undefined : sanitizeComment(dto.comment);
    const feelings = dto.feelings === undefined ? undefined : validateFeelings(dto.feelings);

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.update({
        where: { id },
        data: {
          ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
          ...(comment !== undefined ? { comment } : {}),
          isEdited: true,
          ...(feelings !== undefined ? {
            feelings: { deleteMany: {}, create: feelings.map((f) => ({ group: f.group as never, code: f.code, label: f.label })) },
          } : {}),
        },
        include: { feelings: true },
      });
      await this.recomputeDishRating(tx, existing.dishId);
      await this.rebuildTasteProfile(tx, existing.userId);
      return { reviewId: review.id, rating: review.rating, isEdited: true };
    });
  }

  async remove(user: AuthUser, id: string) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('评价不存在');
    assertOwnerOrAdmin(user, existing.userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });
      await this.recomputeDishRating(tx, existing.dishId);
      await this.rebuildTasteProfile(tx, existing.userId);
      return { deleted: true };
    });
  }

  async listByDish(dishId: string, page = 1, pageSize = 10) {
    const where = { dishId, status: 'VISIBLE' as const };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where, include: { feelings: true, user: { select: { displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);
    const distribution = await this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } });
    return {
      items: rows,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      distribution: Object.fromEntries(distribution.map((d) => [d.rating, d._count._all])),
    };
  }

  /**
   * 评价广场：全平台可见评价流。
   * 只返回 VISIBLE（审核隐藏的不出现），可按时间 / 评分排序，按食堂与是否有短评筛选。
   */
  async listFeed(params: {
    page?: number;
    pageSize?: number;
    sort?: 'latest' | 'highest' | 'lowest';
    minRating?: number;
    maxRating?: number;
    canteenId?: string;
    withComment?: boolean;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
    const sort = params.sort ?? 'latest';

    const where: Prisma.ReviewWhereInput = { status: 'VISIBLE' };
    if (params.minRating !== undefined || params.maxRating !== undefined) {
      where.rating = {
        ...(params.minRating !== undefined ? { gte: params.minRating } : {}),
        ...(params.maxRating !== undefined ? { lte: params.maxRating } : {}),
      };
    }
    if (params.withComment) where.comment = { not: null };
    if (params.canteenId) where.dish = { stall: { canteenId: params.canteenId } };

    const orderBy: Prisma.ReviewOrderByWithRelationInput[] = sort === 'highest'
      ? [{ rating: 'desc' }, { createdAt: 'desc' }]
      : sort === 'lowest'
        ? [{ rating: 'asc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

    const [rows, total, agg, distribution] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          feelings: true,
          user: { select: { displayName: true, avatarUrl: true } },
          dish: {
            select: {
              id: true, name: true, imageUrl: true,
              stall: { select: { name: true, canteen: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({ where, _avg: { rating: true } }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        source: r.source,
        createdAt: r.createdAt,
        feelings: r.feelings.map((f) => ({ code: f.code, label: f.label })),
        user: { displayName: r.user.displayName, avatarUrl: r.user.avatarUrl },
        dish: r.dish,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: {
        total,
        average: agg._avg.rating ?? 0,
        distribution: Object.fromEntries(distribution.map((d) => [d.rating, d._count._all])),
      },
    };
  }

  async mine(user: AuthUser, page = 1, pageSize = 10) {
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { userId: user.id }, include: { feelings: true, dish: { select: { name: true, imageUrl: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.review.count({ where: { userId: user.id } }),
    ]);
    return {
      items: rows,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewDto) {
    return ok(await this.service.create(user, dto), '评价已记录');
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return ok(await this.service.update(user, id, dto), '已更新');
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return ok(await this.service.remove(user, id), '已删除');
  }

  @Get('mine')
  async mine(@CurrentUser() user: AuthUser, @Query('page') page = '1', @Query('pageSize') pageSize = '10') {
    return ok(await this.service.mine(user, Number(page), Number(pageSize)));
  }

  @Get('feed')
  async feed(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort = 'latest',
    @Query('minRating') minRating?: string,
    @Query('maxRating') maxRating?: string,
    @Query('canteenId') canteenId?: string,
    @Query('withComment') withComment?: string,
  ) {
    return ok(await this.service.listFeed({
      page: Number(page),
      pageSize: Number(pageSize),
      sort: sort as 'latest' | 'highest' | 'lowest',
      minRating: minRating !== undefined && minRating !== '' ? Number(minRating) : undefined,
      maxRating: maxRating !== undefined && maxRating !== '' ? Number(maxRating) : undefined,
      canteenId: canteenId || undefined,
      withComment: withComment === 'true',
    }));
  }

  @Get('dish/:dishId')
  async byDish(@Param('dishId') dishId: string, @Query('page') page = '1', @Query('pageSize') pageSize = '10') {
    return ok(await this.service.listByDish(dishId, Number(page), Number(pageSize)));
  }

  @Get('feelings')
  async feelings() {
    return ok({ options: FEELING_OPTIONS, groups: ['OVERALL', 'TASTE', 'PORTION', 'BODY'] });
  }
}

@Module({ controllers: [ReviewsController], providers: [ReviewsService], exports: [ReviewsService] })
export class ReviewsModule {}
