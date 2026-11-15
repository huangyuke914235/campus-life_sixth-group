/** 菜品：组合搜索、详情、评价标签统计、商户维护（价格/食材/标签/营养/库存/上下架）。 */
import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertStallScope, ok } from '../common';

class DishDto {
  @IsString() stallId!: string;
  @IsString() name!: string;
  @IsInt() @Min(0) priceCents!: number;
  @IsString() category!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() ingredients?: string[];
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsArray() allergens?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(5) spiceScore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) oilScore?: number;
  @IsOptional() @IsBoolean() isVegetarian?: boolean;
  @IsOptional() @IsBoolean() isHighProtein?: boolean;
  @IsOptional() @IsBoolean() isNew?: boolean;
  // 营养（估算值，商户录入；有值才写 DishNutrition）
  @IsOptional() @IsInt() @Min(0) energyKcal?: number;
  @IsOptional() @IsInt() @Min(0) proteinG?: number;
  @IsOptional() @IsInt() @Min(0) fatG?: number;
  @IsOptional() @IsInt() @Min(0) carbG?: number;
}

@Injectable()
export class DishesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: { q?: string; category?: string; minPrice?: number; maxPrice?: number; tags?: string[]; canteenId?: string; stallId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 12));
    const where: Prisma.DishWhereInput = {
      status: 'ACTIVE',
      ...(query.q ? {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { category: { contains: query.q, mode: 'insensitive' } },
          { ingredients: { has: query.q } },
        ],
      } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? { priceCents: { gte: query.minPrice ?? 0, lte: query.maxPrice ?? 1_000_000 } } : {}),
      ...(query.tags?.length ? { tags: { some: { name: { in: query.tags } } } } : {}),
      ...(query.stallId ? { stallId: query.stallId } : {}),
      ...(query.canteenId ? { stall: { canteenId: query.canteenId } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dish.findMany({
        where, include: { tags: true, stall: { include: { canteen: { select: { name: true } } } }, nutrition: true },
        orderBy: [{ avgRating: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.dish.count({ where }),
    ]);
    return { items: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async detail(id: string) {
    const dish = await this.prisma.dish.findUnique({
      where: { id },
      include: {
        tags: true, ingredientRows: true, nutrition: true,
        stall: { include: { canteen: true } },
        reviews: { where: { status: 'VISIBLE' }, take: 5, orderBy: { createdAt: 'desc' }, include: { feelings: true, user: { select: { displayName: true } } } },
        _count: { select: { reviews: true, favorites: true } },
      },
    });
    if (!dish) throw Errors.notFound('菜品不存在');
    const feelingStats = await this.prisma.reviewFeeling.groupBy({
      by: ['code', 'label'], where: { review: { dishId: id, status: 'VISIBLE' } }, _count: { _all: true },
    });
    const ratingDist = await this.prisma.review.groupBy({
      by: ['rating'], where: { dishId: id, status: 'VISIBLE' }, _count: { _all: true },
    });
    return {
      ...dish,
      feelingStats: feelingStats.map((f) => ({ code: f.code, label: f.label, count: f._count._all })),
      ratingDistribution: Object.fromEntries(ratingDist.map((r) => [r.rating, r._count._all])),
      nutritionNotice: '营养数值为示例或估算值，非实验室检测结果。',
      matchNotice: '口味匹配度为算法估算结果，不是经过科学验证的精确概率。',
    };
  }

  async create(actor: AuthUser, dto: DishDto) {
    assertStallScope(actor, dto.stallId);
    const { tags, ingredients, energyKcal, proteinG, fatG, carbG, ...rest } = dto;
    return this.prisma.dish.create({
      data: {
        ...rest,
        ingredientRows: { create: (ingredients ?? []).map((name, i) => ({ name, isMain: i < 3, sortOrder: i })) },
        tags: { connectOrCreate: (tags ?? []).map((name) => ({ where: { name }, create: { name, category: 'FLAVOR' } })) },
        ...(energyKcal !== undefined ? {
          nutrition: {
            create: {
              energyKcal, proteinG: proteinG ?? 0, fatG: fatG ?? 0, carbG: carbG ?? 0,
              source: 'ESTIMATED', isEstimated: true,
              sourceNote: '商户录入的估算值，非实验室检测结果',
            },
          },
        } : {}),
      },
    });
  }

  async update(actor: AuthUser, id: string, dto: Partial<DishDto>) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw Errors.notFound('菜品不存在');
    assertStallScope(actor, dish.stallId);
    const { tags, ingredients, energyKcal, proteinG, fatG, carbG, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (ingredients) {
        await tx.dishIngredient.deleteMany({ where: { dishId: id } });
        await tx.dishIngredient.createMany({ data: ingredients.map((name, i) => ({ dishId: id, name, isMain: i < 3, sortOrder: i })) });
      }
      if (energyKcal !== undefined) {
        const data = {
          energyKcal, proteinG: proteinG ?? 0, fatG: fatG ?? 0, carbG: carbG ?? 0,
          source: 'ESTIMATED' as const, isEstimated: true,
          sourceNote: '商户录入的估算值，非实验室检测结果',
        };
        await tx.dishNutrition.upsert({ where: { dishId: id }, create: { dishId: id, ...data }, update: data });
      }
      return tx.dish.update({
        where: { id },
        data: {
          ...rest,
          ...(tags ? { tags: { set: [], connectOrCreate: tags.map((name) => ({ where: { name }, create: { name, category: 'FLAVOR' } })) } } : {}),
        },
      });
    });
  }

  /** 下架而非物理删除，避免订单历史出现孤儿记录。 */
  async offShelf(actor: AuthUser, id: string) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw Errors.notFound('菜品不存在');
    assertStallScope(actor, dish.stallId);
    return this.prisma.dish.update({ where: { id }, data: { status: 'OFF_SHELF' } });
  }
}

@Controller('dishes')
export class DishesController {
  constructor(private readonly s: DishesService) {}
  @Get() async search(@Query() q: Record<string, string>) {
    return ok(await this.s.search({
      q: q.q, category: q.category, minPrice: q.minPrice ? Number(q.minPrice) : undefined,
      maxPrice: q.maxPrice ? Number(q.maxPrice) : undefined,
      tags: q.tags ? q.tags.split(',') : undefined, canteenId: q.canteenId, stallId: q.stallId,
      page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 12,
    }));
  }
  @Get(':id') async detail(@Param('id') id: string) { return ok(await this.s.detail(id)); }
  @Roles('MERCHANT', 'ADMIN') @Post() async create(@CurrentUser() u: AuthUser, @Body() d: DishDto) { return ok(await this.s.create(u, d)); }
  @Roles('MERCHANT', 'ADMIN') @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: Partial<DishDto>) { return ok(await this.s.update(u, id, d)); }
  @Roles('MERCHANT', 'ADMIN') @Post(':id/off-shelf') async off(@CurrentUser() u: AuthUser, @Param('id') id: string) { return ok(await this.s.offShelf(u, id)); }
}

@Module({ controllers: [DishesController], providers: [DishesService], exports: [DishesService] })
export class DishesModule {}
