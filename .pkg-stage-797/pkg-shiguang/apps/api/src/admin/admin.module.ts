/**
 * 平台管理：用户与角色、内容审核、订单监督、公告、看板、操作日志。
 * 所有写操作记录 AuditLog；审核只改展示状态，不删记录、不改均分与画像。
 */
import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Errors, Roles, ok } from '../common';

class RoleDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AnnouncementDto {
  @IsString() title!: string;
  @IsString() body!: string;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() canteenId?: string;
}

class ModerateDto {
  @IsString() status!: string; // VISIBLE | HIDDEN
  @IsOptional() @IsString() reason?: string;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  private async audit(actor: AuthUser, action: string, targetType: string, targetId: string, metadata?: object) {
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, actorRole: actor.role, action, targetType, targetId, metadata: metadata as never },
    });
  }

  async dashboard() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [users, canteens, stalls, dishes, todayOrders, pendingReviews, lowStock] = await Promise.all([
      this.prisma.user.count(), this.prisma.canteen.count(), this.prisma.stall.count(), this.prisma.dish.count(),
      this.prisma.order.count({ where: { createdAt: { gte: start } } }),
      this.prisma.review.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.inventory.count({ where: { remaining: { lte: 3 } } }),
    ]);
    return { users, canteens, stalls, dishes, todayOrders, pendingReviews, lowStock };
  }

  async users(page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.user.count(),
    ]);
    return { items: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async updateUser(actor: AuthUser, id: string, dto: RoleDto) {
    if (dto.role && !['STUDENT', 'MERCHANT', 'ADMIN'].includes(dto.role)) throw Errors.invalidParam('角色不合法');
    // 必须 select：直接用 update 返回值会把 passwordHash 泄露给后台页面
    const row = await this.prisma.user.update({
      where: { id },
      data: { role: dto.role as never, isActive: dto.isActive },
      select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true },
    });
    await this.audit(actor, 'USER_ROLE_UPDATE', 'User', id, dto);
    return row;
  }

  async announcements(actor: AuthUser, dto: AnnouncementDto) {
    const row = await this.prisma.systemAnnouncement.create({
      data: {
        title: dto.title, body: dto.body, scope: (dto.scope ?? 'ALL') as never,
        canteenId: dto.canteenId ?? null, authorId: actor.id, publishedAt: new Date(),
      },
    });
    await this.audit(actor, 'ANNOUNCEMENT_PUBLISH', 'SystemAnnouncement', row.id);
    return row;
  }

  /**
   * 评价审核：只改展示状态。均分、画像、推荐依赖的是完整评价集合，
   * 因此隐藏内容不会破坏历史记录与推荐的一致性。
   */
  async moderate(actor: AuthUser, id: string, dto: ModerateDto) {
    if (!['VISIBLE', 'HIDDEN', 'PENDING_REVIEW'].includes(dto.status)) throw Errors.invalidParam('审核状态不合法');
    const row = await this.prisma.review.update({
      where: { id }, data: { status: dto.status as never, moderatedBy: actor.id, moderatedAt: new Date() },
    });
    await this.audit(actor, 'REVIEW_MODERATE', 'Review', id, { status: dto.status, reason: dto.reason });
    return { ...row, note: '仅影响前台展示；评分统计与用户画像保持不变。' };
  }

  /** 全站评价（含已隐藏），供管理员审核用 */
  async reviews(params: { page?: number; pageSize?: number; status?: string }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 20));
    const where = params.status && params.status !== 'ALL' ? { status: params.status as never } : {};
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          feelings: true,
          user: { select: { displayName: true, email: true } },
          dish: {
            select: {
              id: true, name: true,
              stall: { select: { name: true, canteen: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        source: r.source,
        createdAt: r.createdAt,
        feelings: r.feelings.map((f) => ({ code: f.code, label: f.label })),
        user: r.user,
        dish: r.dish,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async orders(page = 1, pageSize = 20) {    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        include: { user: { select: { displayName: true } }, stall: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.order.count(),
    ]);
    return { items: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async auditLogs(page = 1, pageSize = 30) {
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count(),
    ]);
    return { items: rows, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
}

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly s: AdminService) {}
  @Get('dashboard') async dashboard() { return ok(await this.s.dashboard()); }
  @Get('users') async users(@Query('page') p = '1', @Query('pageSize') ps = '20') { return ok(await this.s.users(Number(p), Number(ps))); }
  @Patch('users/:id') async updateUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: RoleDto) { return ok(await this.s.updateUser(u, id, d)); }
  @Post('announcements') async announcements(@CurrentUser() u: AuthUser, @Body() d: AnnouncementDto) { return ok(await this.s.announcements(u, d)); }
  @Patch('reviews/:id/moderate') async moderate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: ModerateDto) { return ok(await this.s.moderate(u, id, d)); }
  @Get('reviews') async reviews(@Query('page') p = '1', @Query('pageSize') ps = '20', @Query('status') status = 'ALL') { return ok(await this.s.reviews({ page: Number(p), pageSize: Number(ps), status })); }
  @Get('orders') async orders(@Query('page') p = '1', @Query('pageSize') ps = '20') { return ok(await this.s.orders(Number(p), Number(ps))); }
  @Get('audit-logs') async logs(@Query('page') p = '1', @Query('pageSize') ps = '30') { return ok(await this.s.auditLogs(Number(p), Number(ps))); }
}

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
