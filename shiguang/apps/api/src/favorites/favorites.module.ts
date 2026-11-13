/** 收藏：真实入库，支持按食堂筛选、查看当前是否供应、快速加购行为记录。 */
import { Controller, Delete, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, ok } from '../common';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, canteenId?: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId: user.id, ...(canteenId ? { dish: { stall: { canteenId } } } : {}) },
      include: { dish: { include: { stall: { include: { canteen: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((f) => ({
      ...f, dish: { ...f.dish, isAvailable: f.dish.status === 'ACTIVE' },
    }));
  }

  async add(user: AuthUser, dishId: string) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, include: { tags: true } });
    if (!dish) throw Errors.notFound('菜品不存在');
    const favorite = await this.prisma.favorite.upsert({
      where: { userId_dishId: { userId: user.id, dishId } },
      create: { userId: user.id, dishId }, update: {},
    });
    await this.prisma.userBehavior.create({
      data: { userId: user.id, dishId, type: 'FAVORITE_ADD', payload: { dishTags: dish.tags.map((t) => t.name) } },
    });
    return favorite;
  }

  async remove(user: AuthUser, dishId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId: user.id, dishId } });
    await this.prisma.userBehavior.create({ data: { userId: user.id, dishId, type: 'FAVORITE_REMOVE' } });
    return { removed: true };
  }
}

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly s: FavoritesService) {}
  @Get() async list(@CurrentUser() u: AuthUser, @Query('canteenId') canteenId?: string) { return ok(await this.s.list(u, canteenId)); }
  @Post(':dishId') async add(@CurrentUser() u: AuthUser, @Param('dishId') id: string) { return ok(await this.s.add(u, id)); }
  @Delete(':dishId') async remove(@CurrentUser() u: AuthUser, @Param('dishId') id: string) { return ok(await this.s.remove(u, id)); }
}

@Module({ controllers: [FavoritesController], providers: [FavoritesService] })
export class FavoritesModule {}
