/**
 * Auth 模块：Argon2id 密码哈希、JWT 双令牌、安全 Cookie、刷新轮换、
 * 登录防爆破、RBAC 后端校验、演示账号开关。
 */
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Post,
  Body,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { demoAccountsEnabled, isDemoAccountEmail } from './demo-accounts';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser, CurrentUser, Errors, IS_PUBLIC_KEY, Public, Roles, RolesGuard,
  assertOwnerOrAdmin, loginRateLimit, ok, rateLimit,
} from '../common';

// ─────────────────────── DTO ───────────────────────

class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(72, { message: '密码过长' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码需同时包含字母与数字' })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(24)
  displayName!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;
  @IsString()
  @MinLength(1)
  password!: string;
}

// ─────────────────────── 密码 / 令牌工具 ───────────────────────

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

function isDisabledDemoAccount(email: string, config: ConfigService): boolean {
  return !demoAccountsEnabled(config) && isDemoAccountEmail(email, config);
}

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService) {}

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: Number(this.config.get('ARGON2_MEMORY_COST') ?? 19456),
      timeCost: Number(this.config.get('ARGON2_TIME_COST') ?? 2),
      parallelism: Number(this.config.get('ARGON2_PARALLELISM') ?? 1),
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try { return await argon2.verify(hash, plain); } catch { return false; }
  }
}

// ─────────────────────── JWT Guard ───────────────────────

type ReqWithUser = Request & { user?: AuthUser; cookies?: Record<string, string> };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<ReqWithUser>();
    const auth = req.headers.authorization;
    const token = req.cookies?.access_token ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
    if (!token) throw Errors.unauthorized();
    let payload: { sub: string; email: string; role: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
    } catch {
      throw Errors.unauthorized('登录已失效，请重新登录');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, role: true, displayName: true, isActive: true, privacyDeleteAt: true,
        stallAssignments: { select: { id: true } },
      },
    });
    if (!user || !user.isActive || user.privacyDeleteAt || isDisabledDemoAccount(user.email, this.config)) {
      throw Errors.unauthorized('账号不可用');
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as AuthUser['role'],
      displayName: user.displayName,
      stallIds: user.stallAssignments.map((s) => s.id),
    };
    return true;
  }
}

// ─────────────────────── Auth Service ───────────────────────

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions(maxAge: number) {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      sameSite: (this.config.get('COOKIE_SAMESITE') || 'lax') as 'lax' | 'strict' | 'none',
      domain: this.config.get('COOKIE_DOMAIN') || undefined,
      path: '/',
      maxAge,
    };
  }

  private async createTokens(
    user: { id: string; email: string; role: string },
    req: Request,
    db: Pick<Prisma.TransactionClient, 'refreshToken'> = this.prisma,
  ) {
    const access = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: this.config.get('JWT_ACCESS_TTL') || '900s' },
    );
    const refresh = await this.jwt.signAsync(
      { sub: user.id, jti: randomBytes(16).toString('hex') },
      { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: this.config.get('JWT_REFRESH_TTL') || '7d' },
    );
    const accessExpiresAt = this.jwt.decode<{ exp: number }>(access).exp * 1000;
    const refreshExpiresAt = this.jwt.decode<{ exp: number }>(refresh).exp * 1000;
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refresh),
        userAgent: (req.headers['user-agent'] || '').slice(0, 200),
        ip: (req.ip || '').slice(0, 64),
        expiresAt: new Date(refreshExpiresAt),
      },
    });
    return { access, refresh, accessExpiresAt, refreshExpiresAt };
  }

  private setTokenCookies(res: Response, tokens: Awaited<ReturnType<AuthService['createTokens']>>) {
    const now = Date.now();
    const refreshOptions = this.cookieOptions(tokens.refreshExpiresAt - now);
    res.cookie('access_token', tokens.access, this.cookieOptions(tokens.accessExpiresAt - now));
    res.cookie('refresh_token', tokens.refresh, refreshOptions);
    // CSRF 双提交令牌：必须可被前端 JS 读取，故 httpOnly=false
    res.cookie('csrf_token', randomBytes(24).toString('hex'), {
      ...refreshOptions,
      httpOnly: false,
    });
  }

  async register(dto: RegisterDto, req: Request, res: Response) {
    const email = dto.email.trim().toLowerCase();
    if (isDemoAccountEmail(email, this.config)) throw Errors.invalidParam('该邮箱不可注册');
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw Errors.invalidParam('该邮箱已注册');
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, displayName: dto.displayName.trim(), role: 'STUDENT' },
      select: { id: true, email: true, displayName: true, role: true },
    });
    this.setTokenCookies(res, await this.createTokens(user, req));
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    const ip = req.ip || 'unknown';
    loginRateLimit(ip, dto.email, Number(this.config.get('LOGIN_RATE_LIMIT_MAX') ?? 10), Number(this.config.get('RATE_LIMIT_WINDOW_MS') ?? 60000));
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // 用户不存在也做一次哈希校验，避免通过响应时间枚举账号
    const hash = user?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await this.passwords.verify(hash, dto.password).catch(() => false);
    if (!user || !valid || !user.isActive || user.privacyDeleteAt || isDisabledDemoAccount(user.email, this.config)) {
      throw Errors.unauthorized('邮箱或密码不正确');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    this.setTokenCookies(res, await this.createTokens(user, req));
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, onboardedAt: user.onboardedAt };
  }

  async refresh(req: Request, res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.refresh_token;
    if (!token) throw Errors.unauthorized();
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_REFRESH_SECRET') });
    } catch { throw Errors.unauthorized('刷新令牌无效'); }
    const tokens = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.refreshToken.updateMany({
        where: { tokenHash: sha256(token), userId: payload.sub, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) throw Errors.unauthorized('刷新令牌已失效');
      const user = await tx.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, isActive: true, privacyDeleteAt: true },
      });
      if (!user || !user.isActive || user.privacyDeleteAt || isDisabledDemoAccount(user.email, this.config)) {
        throw Errors.unauthorized();
      }
      return this.createTokens(user, req, tx);
    });
    this.setTokenCookies(res, tokens);
    return { refreshed: true };
  }

  async logout(req: Request, res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.refresh_token;
    if (token) {
      await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const { maxAge: _maxAge, ...cookieOptions } = this.cookieOptions(0);
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions);
    res.clearCookie('csrf_token', { ...cookieOptions, httpOnly: false });
    return { loggedOut: true };
  }

  async demoAccounts() {
    if (!demoAccountsEnabled(this.config)) return { enabled: false, accounts: [] };

    const users = await this.prisma.user.findMany({
      where: { email: { endsWith: '@demo.shiguang.local', mode: 'insensitive' }, isActive: true, privacyDeleteAt: null },
      select: { email: true, displayName: true, role: true },
    });

    /** 画像标签：让体验账号不只是邮箱，还能看出「这个人是哪一派」 */
    const profileTag: Record<string, string> = {
      'student.a': '微辣鸡肉米饭派',
      'student.b': '清淡蔬菜面食派',
      'student.c0': '川湘重口派',
      'student.c1': '预算敏感派',
      'student.c2': '夜宵常客',
      'student.c3': '清淡汤饮派',
    };
    const roleLabel: Record<string, string> = { STUDENT: '学生', MERCHANT: '食堂商户', ADMIN: '平台管理员' };
    const roleOrder: Record<string, number> = { STUDENT: 0, MERCHANT: 1, ADMIN: 2 };

    const accounts = users
      .map((u) => {
        const tag = profileTag[u.email.split('@')[0]];
        const base = `${roleLabel[u.role] ?? u.role} · ${u.displayName}`;
        return { role: u.role, label: tag ? `${base} · ${tag}` : base, email: u.email };
      })
      .sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));

    return {
      enabled: true,
      notice: '以下为平台提供的体验账号，点击即可填入邮箱。',
      accounts,
    };
  }
}

// ─────────────────────── Controller ───────────────────────

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return ok(await this.auth.register(dto, req, res), '注册成功');
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return ok(await this.auth.login(dto, req, res), '登录成功');
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return ok(await this.auth.refresh(req, res), '已刷新');
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return ok(await this.auth.logout(req, res), '已退出');
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return ok(user);
  }

  @Public()
  @Get('demo-accounts')
  async demoAccounts() {
    return ok(await this.auth.demoAccounts());
  }
}

@Module({
  imports: [
    // global: true —— 全局 APP_GUARD 注册在 AppModule 作用域，需要能解析 JwtService
    JwtModule.register({ global: true }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtAuthGuard],
  exports: [AuthService, PasswordService, JwtAuthGuard],
})
export class AuthModule {}
