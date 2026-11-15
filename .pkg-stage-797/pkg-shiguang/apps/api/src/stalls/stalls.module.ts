/** 档口：查询与管理。商户的所有写操作都经过 assertStallScope 数据边界校验。 */
import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, assertStallScope, ok } from '../common';

class StallDto {
  @IsString() canteenId!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() windowNo?: string;
  @IsOptional() @IsString() openTime?: string;
  @IsOptional() @IsString() closeTime?: string;
}

@Injectable()
export class StallsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(canteenId?: string) {
    return this.prisma.stall.findMany({
      where: { isActive: true, ...(canteenId ? { canteenId } : {}) },
      include: { canteen: { select: { name: true, location: true } }, _count: { select: { dishes: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async detail(id: string) {
    const row = await this.prisma.stall.findUnique({
      where: { id }, include: { canteen: true, dishes: { where: { status: 'ACTIVE' }, take: 30 } },
    });
    if (!row) throw Errors.notFound('档口不存在');
    return row;
  }

  /** 管理员建档口；商户只能管理已授权档口。 */
  async create(actor: AuthUser, dto: StallDto) {
    if (actor.role === 'MERCHANT') throw Errors.forbidden('仅管理员可新建档口');
    return this.prisma.stall.create({ data: dto });
  }

  async assertScope(actor: AuthUser, stallId: string) {
    assertStallScope(actor, stallId);
    const stall = await this.prisma.stall.findUnique({ where: { id: stallId } });
    if (!stall) throw Errors.notFound('档口不存在');
    return stall;
  }
}

@Controller('stalls')
export class StallsController {
  constructor(private readonly s: StallsService) {}
  @Get() async list(@Query('canteenId') canteenId?: string) { return ok(await this.s.list(canteenId)); }
  @Get(':id') async detail(@Param('id') id: string) { return ok(await this.s.detail(id)); }
  @Roles('ADMIN') @Post() async create(@CurrentUser() u: AuthUser, @Body() d: StallDto) { return ok(await this.s.create(u, d)); }
}

@Module({ controllers: [StallsController], providers: [StallsService], exports: [StallsService] })
export class StallsModule {}
