/** 每日菜单：按日期/餐次/食堂/档口查询，商户发布、复制昨日、批量上下架、库存设置。 */
import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MealType, Prisma } from '@prisma/client';
import { campusDate, parseCampusDate } from '@shiguang/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertStallScope, ok } from '../common';

class MenuContextDto {
  @IsString() stallId!: string;
  @IsString() date!: string;
  @IsIn(Object.values(MealType)) mealType!: MealType;
}

class PublishDto extends MenuContextDto {
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsString({ each: true }) dishIds!: string[];
  @IsOptional() @IsInt() @Min(0) defaultStock?: number;
}

class ToggleItemDto {
  @IsBoolean() isAvailable!: boolean;
}

class SetStockDto {
  @IsInt() @Min(0) remaining!: number;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

@Injectable()
export class MenusService {
  constructor(private readonly prisma: PrismaService) {}

  async query(date: string, mealType?: string, canteenId?: string, stallId?: string, actor?: AuthUser) {
    const d = parseCampusDate(date);
    if (!d || (mealType && !Object.values(MealType).includes(mealType as MealType))) {
      throw Errors.invalidParam('日期或餐次不合法');
    }
    if (actor && stallId) assertStallScope(actor, stallId);
    const stallScope: Prisma.MenuWhereInput = stallId
      ? { stallId }
      : actor?.role === 'MERCHANT' ? { stallId: { in: actor.stallIds ?? [] } } : {};
    const menus = await this.prisma.menu.findMany({
      where: {
        date: d,
        ...(actor ? {} : { status: 'PUBLISHED' }),
        ...(mealType ? { mealType: mealType as MealType } : {}),
        ...stallScope,
        stall: {
          canteenId,
          ...(actor ? {} : { isActive: true, canteen: { isOpen: true } }),
        },
      },
      include: {
        stall: { include: { canteen: { select: { name: true } } } },
        items: {
          where: actor ? {} : { isAvailable: true, dish: { status: 'ACTIVE' } },
          include: { dish: { include: { tags: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ mealType: 'asc' }, { stallId: 'asc' }],
    });
    const dishIds = menus.flatMap((m) => m.items.map((i) => i.dishId));
    const inv = await this.prisma.inventory.findMany({ where: { dishId: { in: dishIds }, date: d } });
    const stock = new Map(inv.map((i) => [`${i.dishId}:${i.mealType}`, i]));
    return menus.map((m) => ({
      ...m,
      items: m.items.map((i) => {
        const row = stock.get(`${i.dishId}:${m.mealType}`);
        return {
          ...i, inventoryId: row?.id ?? null, stockTotal: row?.total ?? 0, stockRemaining: row?.remaining ?? 0,
          ...(actor ? { stockVersion: row?.version ?? null } : {}),
        };
      }),
    }));
  }

  async managedStalls(actor: AuthUser) {
    return this.prisma.stall.findMany({
      where: actor.role === 'ADMIN' ? {} : { id: { in: actor.stallIds ?? [] } },
      select: { id: true, name: true, canteen: { select: { name: true } } },
      orderBy: [{ canteen: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  async publish(actor: AuthUser, dto: PublishDto) {
    assertStallScope(actor, dto.stallId);
    const date = parseCampusDate(dto.date);
    if (!date) throw Errors.invalidParam('日期不合法');

    return this.prisma.withSerializable(async (tx) => {
      const dishes = await tx.dish.count({ where: { id: { in: dto.dishIds }, stallId: dto.stallId, status: 'ACTIVE' } });
      if (dishes !== dto.dishIds.length) throw Errors.invalidParam('只能发布本档口在架菜品');
      const menu = await tx.menu.upsert({
        where: { stallId_date_mealType: { stallId: dto.stallId, date, mealType: dto.mealType } },
        create: { stallId: dto.stallId, date, mealType: dto.mealType, status: 'PUBLISHED', publishedAt: new Date() },
        update: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      for (let i = 0; i < dto.dishIds.length; i += 1) {
        const dishId = dto.dishIds[i];
        await tx.menuItem.upsert({
          where: { menuId_dishId: { menuId: menu.id, dishId } },
          create: { menuId: menu.id, dishId, isAvailable: true, sortOrder: i },
          update: { isAvailable: true, sortOrder: i },
        });
        await tx.inventory.upsert({
          where: { dishId_date_mealType: { dishId, date, mealType: dto.mealType } },
          create: { dishId, date, mealType: dto.mealType, total: dto.defaultStock ?? 30, remaining: dto.defaultStock ?? 30 },
          update: {},
        });
      }
      return menu;
    });
  }

  /** 复制昨日菜单：仅复制仍在架的菜品，库存按新日期重新初始化。 */
  async copyYesterday(actor: AuthUser, stallId: string, date: string, mealType: MealType) {
    assertStallScope(actor, stallId);
    const target = parseCampusDate(date);
    if (!target) throw Errors.invalidParam('日期不合法');
    const yesterday = new Date(target.getTime() - 86_400_000);
    const source = await this.prisma.menu.findUnique({
      where: { stallId_date_mealType: { stallId, date: yesterday, mealType } },
      include: { items: { include: { dish: true } } },
    });
    if (!source) throw Errors.notFound('昨日没有可复制的菜单');
    const activeIds = source.items.filter((i) => i.isAvailable && i.dish.status === 'ACTIVE').map((i) => i.dishId);
    if (activeIds.length === 0) throw Errors.invalidParam('昨日菜单没有仍在架的菜品');
    return this.publish(actor, { stallId, date, mealType, dishIds: activeIds, defaultStock: 30 });
  }

  async toggleItem(actor: AuthUser, itemId: string, isAvailable: boolean) {
    const item = await this.prisma.menuItem.findUnique({ where: { id: itemId }, include: { menu: true } });
    if (!item) throw Errors.notFound('菜单项不存在');
    assertStallScope(actor, item.menu.stallId);
    return this.prisma.menuItem.update({ where: { id: itemId }, data: { isAvailable } });
  }

  async setStock(actor: AuthUser, inventoryId: string, remaining: number, expectedVersion?: number) {
    const inv = await this.prisma.inventory.findUnique({ where: { id: inventoryId }, include: { dish: true } });
    if (!inv) throw Errors.notFound('库存记录不存在');
    assertStallScope(actor, inv.dish.stallId);
    if (remaining < 0 || remaining > inv.total) throw Errors.invalidParam('可售数量不合法');
    const saved = await this.prisma.inventory.updateMany({
      where: { id: inventoryId, version: expectedVersion ?? inv.version },
      data: { remaining, version: { increment: 1 } },
    });
    if (saved.count !== 1) throw Errors.inventoryConflict('库存有新变化，请刷新后重试');
    return { id: inventoryId, remaining };
  }
}

@Controller('menus')
export class MenusController {
  constructor(private readonly s: MenusService) {}
  @Get() async query(@Query('date') date: string, @Query('mealType') mealType?: string, @Query('canteenId') canteenId?: string, @Query('stallId') stallId?: string) {
    return ok(await this.s.query(date ?? campusDate(new Date()), mealType, canteenId, stallId));
  }
  @Roles('MERCHANT', 'ADMIN') @Get('manage') async manage(
    @CurrentUser() u: AuthUser, @Query('date') date?: string, @Query('mealType') mealType?: string, @Query('stallId') stallId?: string,
  ) {
    return ok(await this.s.query(date ?? campusDate(new Date()), mealType, undefined, stallId, u));
  }
  @Roles('MERCHANT', 'ADMIN') @Get('manage/stalls') async managedStalls(@CurrentUser() u: AuthUser) {
    return ok(await this.s.managedStalls(u));
  }
  @Roles('MERCHANT', 'ADMIN') @Post('publish') async publish(@CurrentUser() u: AuthUser, @Body() d: PublishDto) { return ok(await this.s.publish(u, d)); }
  @Roles('MERCHANT', 'ADMIN') @Post('copy-yesterday') async copy(@CurrentUser() u: AuthUser, @Body() d: MenuContextDto) {
    return ok(await this.s.copyYesterday(u, d.stallId, d.date, d.mealType));
  }
  @Roles('MERCHANT', 'ADMIN') @Patch('items/:id') async toggle(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ToggleItemDto) { return ok(await this.s.toggleItem(u, id, d.isAvailable)); }
  @Roles('MERCHANT', 'ADMIN') @Patch('inventory/:id') async stock(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: SetStockDto) {
    return ok(await this.s.setStock(u, id, d.remaining, d.expectedVersion));
  }
}

@Module({ controllers: [MenusController], providers: [MenusService] })
export class MenusModule {}
