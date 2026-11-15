/** 食堂：列表、详情、当前营业状态、公告；写操作仅管理员。 */
import { Body, Controller, Get, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, ok } from '../common';

class CanteenDto {
  @IsString() name!: string;
  @IsString() location!: string;
  @IsString() openTime!: string;
  @IsString() closeTime!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() notice?: string;
  @IsOptional() @IsBoolean() isOpen?: boolean;
}

@Injectable()
export class CanteensService {
  constructor(private readonly prisma: PrismaService) {}

  private isOpenNow(open: string, close: string): boolean {
    const now = new Date();
    const minutes = (now.getUTCHours() + 8) * 60 + now.getUTCMinutes();
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    return minutes >= oh * 60 + om && minutes <= ch * 60 + cm;
  }

  async list() {
    const rows = await this.prisma.canteen.findMany({
      include: { _count: { select: { stalls: true } }, announcements: { where: { publishedAt: { not: null } }, take: 1, orderBy: { publishedAt: 'desc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      ...c, stallCount: c._count.stalls,
      currentlyOpen: c.isOpen && this.isOpenNow(c.openTime, c.closeTime),
      latestAnnouncement: c.announcements[0]?.body ?? null,
    }));
  }

  async detail(id: string) {
    const row = await this.prisma.canteen.findUnique({
      where: { id }, include: { stalls: { where: { isActive: true } }, announcements: { where: { publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, take: 5 } },
    });
    if (!row) throw Errors.notFound('食堂不存在');
    return { ...row, currentlyOpen: row.isOpen && this.isOpenNow(row.openTime, row.closeTime) };
  }

  async create(actor: AuthUser, dto: CanteenDto) {
    const row = await this.prisma.canteen.create({ data: dto });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'CANTEEN_CREATE', targetType: 'Canteen', targetId: row.id } });
    return row;
  }

  async update(actor: AuthUser, id: string, dto: Partial<CanteenDto>) {
    const row = await this.prisma.canteen.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, actorRole: actor.role, action: 'CANTEEN_UPDATE', targetType: 'Canteen', targetId: id, metadata: dto as never } });
    return row;
  }
}

@Controller('canteens')
export class CanteensController {
  constructor(private readonly s: CanteensService) {}
  @Get() async list(@Query('open') open?: string) {
    const rows = await this.s.list();
    return ok(open === 'true' ? rows.filter((r) => r.currentlyOpen) : rows);
  }
  @Get(':id') async detail(@Param('id') id: string) { return ok(await this.s.detail(id)); }
  @Roles('ADMIN') @Post() async create(@CurrentUser() u: AuthUser, @Body() d: CanteenDto) { return ok(await this.s.create(u, d)); }
  @Roles('ADMIN') @Put(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: Partial<CanteenDto>) { return ok(await this.s.update(u, id, d)); }
}

@Module({ controllers: [CanteensController], providers: [CanteensService] })
export class CanteensModule {}
