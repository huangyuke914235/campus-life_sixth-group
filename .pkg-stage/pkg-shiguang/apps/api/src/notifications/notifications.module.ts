/**
 * 站内通知：订单状态、评价提醒、食堂公告。
 * 默认无需任何第三方凭证；邮件 / 短信 / Web Push 由 NotificationProvider 预留接口。
 */
import { Controller, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, ok } from '../common';

export interface NotificationProvider {
  readonly name: string;
  send(userId: string, title: string, body: string): Promise<void>;
}

/** 站内信为默认实现；外部渠道需配置凭证后才可启用。 */
export class InAppNotificationProvider implements NotificationProvider {
  readonly name = 'in-app';
  constructor(private readonly prisma: PrismaService) {}
  async send(userId: string, title: string, body: string): Promise<void> {
    await this.prisma.notification.create({ data: { userId, type: 'SYSTEM', title, body } });
  }
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, unreadOnly = false) {
    const rows = await this.prisma.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    const unread = await this.prisma.notification.count({ where: { userId: user.id, readAt: null } });
    return { items: rows, unreadCount: unread };
  }

  async markRead(user: AuthUser, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { read: true };
  }

  async markAllRead(user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { read: true };
  }

  async announcements() {
    return this.prisma.systemAnnouncement.findMany({
      where: { publishedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { publishedAt: 'desc' }, take: 20,
    });
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly s: NotificationsService) {}
  @Get() async list(@CurrentUser() u: AuthUser) { return ok(await this.s.list(u)); }
  @Patch(':id/read') async read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return ok(await this.s.markRead(u, id)); }
  @Post('read-all') async readAll(@CurrentUser() u: AuthUser) { return ok(await this.s.markAllRead(u)); }
  @Get('announcements') async announcements() { return ok(await this.s.announcements()); }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService, InAppNotificationProvider] })
export class NotificationsModule {}
