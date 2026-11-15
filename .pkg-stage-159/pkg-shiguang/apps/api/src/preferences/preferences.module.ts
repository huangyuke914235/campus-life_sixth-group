/**
 * 口味画像模块：显式偏好（问卷/设置）、系统推断画像、忌口与过敏原。
 * 关键约束：系统推断永不写入 UserPreference / DietaryRestriction；
 * 过敏原为硬性过滤条件，且必须附带「交叉接触风险」说明。
 */
import { Body, Controller, Delete, Get, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { emptyTasteProfile, FEELING_DISCLAIMER } from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, ok } from '../common';

class PreferenceDto {
  @IsOptional() @IsArray() cuisines?: string[];
  @IsOptional() @IsArray() staplePreferences?: string[];
  @IsOptional() @IsArray() ingredientLikes?: string[];
  @IsOptional() @IsArray() ingredientDislikes?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(5) spiceTolerance?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) sweetness?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) saltiness?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) oilTolerance?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) flavorIntensity?: number;
  @IsOptional() @IsArray() specialLikes?: string[];
  @IsOptional() @IsInt() @Min(0) budgetMinCents?: number;
  @IsOptional() @IsInt() @Min(0) budgetMaxCents?: number;
  @IsOptional() @IsArray() preferredCanteenIds?: string[];
  @IsOptional() @IsArray() preferredStallIds?: string[];
  @IsOptional() @IsArray() usualMealTimes?: string[];
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsBoolean() adventurous?: boolean;
  @IsOptional() @IsString() dietPattern?: string;
}

class RestrictionDto {
  @IsString() kind!: string;
  @IsString() value!: string;
  @IsOptional() @IsString() note?: string;
}

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId: user.id } });
    return { preference: pref, completed: !!pref };
  }

  /** 问卷 / 设置页写入；同时标记 onboardedAt。 */
  async save(user: AuthUser, dto: PreferenceDto) {
    if (dto.budgetMinCents !== undefined && dto.budgetMaxCents !== undefined && dto.budgetMinCents > dto.budgetMaxCents) {
      throw Errors.invalidParam('预算下限不能大于上限');
    }
    const data = { ...dto, priority: dto.priority as never, dietPattern: dto.dietPattern as never };
    const pref = await this.prisma.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data } as never,
      update: data as never,
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
    return pref;
  }

  /** 我的口味画像：显式偏好 + 推断画像 + 变化摘要，两者明确区分。 */
  async profile(user: AuthUser) {
    const [pref, inferred, restrictions, reviewCount] = await Promise.all([
      this.prisma.userPreference.findUnique({ where: { userId: user.id } }),
      this.prisma.userTasteProfile.findUnique({ where: { userId: user.id } }),
      this.prisma.dietaryRestriction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.review.count({ where: { userId: user.id } }),
    ]);
    const topTags = Object.entries((inferred?.tagWeights ?? {}) as Record<string, number>)
      .filter(([, w]) => w > 0.55).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([tag]) => tag);
    return {
      explicit: pref ? {
        spiceTolerance: pref.spiceTolerance, cuisines: pref.cuisines,
        staplePreferences: pref.staplePreferences, ingredientLikes: pref.ingredientLikes,
        budget: `¥${(pref.budgetMinCents / 100).toFixed(0)}–${(pref.budgetMaxCents / 100).toFixed(0)}`,
        priority: pref.priority, adventurous: pref.adventurous, dietPattern: pref.dietPattern,
      } : null,
      inferred: inferred ? {
        topTags, oilTolerance: inferred.oilToleranceInferred,
        spiceAffinity: inferred.spiceAffinity, vegetableAffinity: inferred.vegetableAffinity,
        confidence: inferred.confidence, feedbackCount: inferred.feedbackCount,
        lastUpdatedAt: inferred.lastUpdatedAt,
      } : null,
      restrictions: restrictions.map((r) => ({ kind: r.kind, value: r.value, source: r.source })),
      reviewCount,
      summary: topTags.length > 0
        ? `系统根据 ${reviewCount} 条真实评价推断你偏好${topTags.slice(0, 3).join('、')}；这部分可随时重置。`
        : '还没有足够的反馈生成推断偏好，推荐目前主要依据你填写的问卷。',
      disclaimers: [FEELING_DISCLAIMER, '系统推断不会覆盖你明确设置的忌口与过敏原。'],
    };
  }

  /** 只清推断，保留显式偏好与忌口。 */
  async resetInferred(user: AuthUser) {
    const blank = emptyTasteProfile(new Date().toISOString());
    await this.prisma.userTasteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, tagWeights: {} as never, confidence: 0, feedbackCount: 0 },
      update: {
        tagWeights: {} as never, confidence: 0, feedbackCount: 0,
        oilToleranceInferred: blank.oilToleranceInferred, spiceAffinity: blank.spiceAffinity,
        saltSensitivity: blank.saltSensitivity, flavorIntensity: blank.flavorIntensity,
        portionPreference: blank.portionPreference, vegetableAffinity: blank.vegetableAffinity,
        proteinAffinity: blank.proteinAffinity, noveltyAffinity: blank.noveltyAffinity,
        lastDecayAt: new Date(),
      },
    });
    return { reset: true, note: '已清除系统推断偏好，你手动设置的忌口与过敏原保持不变。' };
  }

  async addRestriction(user: AuthUser, dto: RestrictionDto) {
    const kind = dto.kind as 'DISLIKE' | 'ALLERGEN' | 'RELIGIOUS' | 'MEDICAL';
    if (!['DISLIKE', 'ALLERGEN', 'RELIGIOUS', 'MEDICAL'].includes(kind)) throw Errors.invalidParam('忌口类型不正确');
    const value = dto.value.trim();
    if (!value || value.length > 40) throw Errors.invalidParam('忌口内容不合法');
    // 强制 USER_EXPLICIT：系统推断永远不能写进这张表
    return this.prisma.dietaryRestriction.upsert({
      where: { userId_kind_value: { userId: user.id, kind, value } },
      create: { userId: user.id, kind, value, source: 'USER_EXPLICIT', note: dto.note ?? null },
      update: { source: 'USER_EXPLICIT', note: dto.note ?? null },
    });
  }

  async listRestrictions(user: AuthUser) {
    const items = await this.prisma.dietaryRestriction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    return { items, notice: '食堂信息可能不完整，存在交叉接触风险；过敏原为硬性过滤条件。' };
  }

  async removeRestriction(user: AuthUser, id: string) {
    const row = await this.prisma.dietaryRestriction.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) throw Errors.notFound('记录不存在');
    await this.prisma.dietaryRestriction.delete({ where: { id } });
    return { deleted: true };
  }
}

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly service: PreferencesService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) { return ok(await this.service.get(user)); }

  @Put()
  async save(@CurrentUser() user: AuthUser, @Body() dto: PreferenceDto) { return ok(await this.service.save(user, dto), '偏好已保存'); }

  @Get('profile')
  async profile(@CurrentUser() user: AuthUser) { return ok(await this.service.profile(user)); }

  @Post('profile/reset')
  async reset(@CurrentUser() user: AuthUser) { return ok(await this.service.resetInferred(user)); }

  @Get('restrictions')
  async restrictions(@CurrentUser() user: AuthUser) {
    return ok(await this.service.listRestrictions(user));
  }

  @Post('restrictions')
  async add(@CurrentUser() user: AuthUser, @Body() dto: RestrictionDto) { return ok(await this.service.addRestriction(user, dto)); }

  @Delete('restrictions/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return ok(await this.service.removeRestriction(user, id)); }
}

@Module({ controllers: [PreferencesController], providers: [PreferencesService], exports: [PreferencesService] })
export class PreferencesModule {}
