/** 用户资料：查看 / 修改 / 隐私删除请求（软标记，不物理删除业务记录）。 */
import { Body, Controller, Delete, Get, Injectable, Module, Patch } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, ok } from '../common';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(24) displayName?: string;
  @IsOptional() @IsString() @MaxLength(200) avatarUrl?: string;
  @IsOptional() @IsString() @MaxLength(32) studentNo?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(user: AuthUser) {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, displayName: true, avatarUrl: true, role: true, studentNo: true, onboardedAt: true, createdAt: true },
    });
    return row;
  }

  async update(user: AuthUser, dto: UpdateProfileDto) {
    // 必须显式 select：直接返回 update 结果会把 passwordHash 一起吐给前端
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
      select: { id: true, email: true, displayName: true, avatarUrl: true, role: true, studentNo: true, onboardedAt: true, createdAt: true },
    });
  }

  async requestDeletion(user: AuthUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { isActive: false, privacyDeleteAt: new Date() } });
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return {
      requested: true,
      note: '已停用账号并撤销登录态；业务记录按审计要求保留，个人标识将在后台批处理中匿名化。',
    };
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}
  @Get('me') async me(@CurrentUser() u: AuthUser) { return ok(await this.service.me(u)); }
  @Patch('me') async update(@CurrentUser() u: AuthUser, @Body() d: UpdateProfileDto) { return ok(await this.service.update(u, d)); }
  @Delete('me') async remove(@CurrentUser() u: AuthUser) { return ok(await this.service.requestDeletion(u)); }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
