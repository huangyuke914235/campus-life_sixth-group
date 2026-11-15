/**
 * 全局横切：统一响应 / 统一错误格式 / RBAC / 限流 / 日志脱敏
 * 权限校验一律在后端执行，前端隐藏按钮不构成安全边界。
 */
import {
  ArgumentsHost,
  CanActivate,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
  type CallHandler,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import type { UserRole } from '@shiguang/shared';

// ─────────────────────── 统一响应结构 ───────────────────────

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

export function ok<T>(data: T, message = 'ok', requestId = ''): ApiEnvelope<T> {
  return { code: 0, message, data, timestamp: new Date().toISOString(), requestId };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paged<T>(items: T[], page: number, pageSize: number, total: number, requestId = ''): ApiEnvelope<{ items: T[]; meta: PageMeta }> {
  return ok({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / Math.max(1, pageSize))) } }, 'ok', requestId);
}

// ─────────────────────── 业务错误码 ───────────────────────

export enum BizCode {
  OK = 0,
  INVALID_PARAM = 10001,
  UNAUTHORIZED = 10002,
  FORBIDDEN = 10003,
  NOT_FOUND = 10004,
  CONFLICT = 10005,
  INVENTORY_CONFLICT = 10006,
  DUPLICATE_REVIEW = 10007,
  DUPLICATE_ORDER = 10008,
  SLOT_FULL = 10009,
  SLOT_EXPIRED = 10010,
  REQUEST_TIMEOUT = 10011,
  RATE_LIMITED = 10012,
  CONTENT_REJECTED = 10013,
  TOKEN_INVALID = 10014,
  INTERNAL_ERROR = 10500,
}

const HTTP_TO_BIZ: Record<number, BizCode> = {
  400: BizCode.INVALID_PARAM,
  401: BizCode.UNAUTHORIZED,
  403: BizCode.FORBIDDEN,
  404: BizCode.NOT_FOUND,
  409: BizCode.CONFLICT,
  429: BizCode.RATE_LIMITED,
};

export class BusinessException extends HttpException {
  constructor(
    public readonly bizCode: BizCode,
    message: string,
    public readonly httpStatus: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code: bizCode, message, details }, httpStatus);
  }
}

/** 明确命名的常用业务异常，避免各模块各写一套字符串。 */
export const Errors = {
  invalidParam: (m = '参数错误') => new BusinessException(BizCode.INVALID_PARAM, m, HttpStatus.BAD_REQUEST),
  unauthorized: (m = '请先登录') => new BusinessException(BizCode.UNAUTHORIZED, m, HttpStatus.UNAUTHORIZED),
  forbidden: (m = '权限不足') => new BusinessException(BizCode.FORBIDDEN, m, HttpStatus.FORBIDDEN),
  notFound: (m = '数据不存在') => new BusinessException(BizCode.NOT_FOUND, m, HttpStatus.NOT_FOUND),
  inventoryConflict: (m = '库存不足') => new BusinessException(BizCode.INVENTORY_CONFLICT, m, HttpStatus.CONFLICT),
  duplicateReview: (m = '该订单菜品已评价') => new BusinessException(BizCode.DUPLICATE_REVIEW, m, HttpStatus.CONFLICT),
  duplicateOrder: (m = '重复提交订单') => new BusinessException(BizCode.DUPLICATE_ORDER, m, HttpStatus.CONFLICT),
  slotFull: (m = '该时段预约已满') => new BusinessException(BizCode.SLOT_FULL, m, HttpStatus.CONFLICT),
  slotExpired: (m = '预约时间已过') => new BusinessException(BizCode.SLOT_EXPIRED, m, HttpStatus.BAD_REQUEST),
  contentRejected: (m = '内容包含不允许的字符') => new BusinessException(BizCode.CONTENT_REJECTED, m, HttpStatus.BAD_REQUEST),
  tokenInvalid: (m = '取餐凭证无效') => new BusinessException(BizCode.TOKEN_INVALID, m, HttpStatus.BAD_REQUEST),
};

// ─────────────────────── 全局异常过滤 + 脱敏 ───────────────────────

const SENSITIVE_KEYS = ['password', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'authorization', 'cookie', 'secret', 'idempotencyKey'];

/** 递归脱敏，日志中永不出现密码、令牌与 Cookie。 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))
        ? '[REDACTED]'
        : sanitize(v, depth + 1);
    });
    return out;
  }
  return value;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = (req.headers['x-request-id'] as string) || '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: BizCode = BizCode.INTERNAL_ERROR;
    let message = '服务异常，请稍后重试';
    let details: unknown;

    if (exception instanceof BusinessException) {
      status = exception.httpStatus;
      code = exception.bizCode;
      message = (exception.getResponse() as { message?: string }).message ?? message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HTTP_TO_BIZ[status] ?? BizCode.INTERNAL_ERROR;
      const body = exception.getResponse() as { message?: string | string[] };
      message = Array.isArray(body?.message) ? body.message.join('；') : (body?.message ?? message);
    } else if (process.env.NODE_ENV !== 'production') {
      // 非生产环境把真实异常信息带到响应里，便于自查；生产环境统一返回通用文案
      message = `服务异常：${(exception as Error)?.message ?? 'unknown'}`;
    }

    this.logger.error(JSON.stringify({
      requestId,
      method: req.method,
      // 只记录路径，不记录 query 中的敏感参数
      path: req.path,
      status,
      code,
      message,
      body: sanitize(req.body),
    }));

    res.status(status).json({
      code,
      message,
      data: details ?? null,
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const id = (req.headers['x-request-id'] as string) || Math.random().toString(36).slice(2, 12);
    res.setHeader('x-request-id', id);
    return next.handle().pipe(tap(() => res.setHeader('x-request-id', id)));
  }
}

// ─────────────────────── RBAC ───────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string;
  stallIds?: string[]; // 商户被授权的档口
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 由 JwtStrategy 注入 req.user；Guard 在后端强制校验角色。 */
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const required = Reflect.getMetadata(ROLES_KEY, context.getHandler()) as UserRole[] | undefined
      ?? Reflect.getMetadata(ROLES_KEY, context.getClass()) as UserRole[] | undefined;
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('请先登录');
    if (!required.includes(user.role)) throw new ForbiddenException('权限不足');
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user,
);

/**
 * 商户只能操作自己被授权的档口。所有订单 / 菜品 / 菜单写接口都必须调用。
 */
export function assertStallScope(user: AuthUser, stallId: string): void {
  if (user.role === 'ADMIN') return;
  if (user.role !== 'MERCHANT' || !(user.stallIds ?? []).includes(stallId)) {
    throw new ForbiddenException('只能操作自己被授权的档口');
  }
}

export function assertOwnerOrAdmin(user: AuthUser, ownerUserId: string): void {
  if (user.role === 'ADMIN') return;
  if (user.id !== ownerUserId) throw new ForbiddenException('无权访问他人数据');
}

// ─────────────────────── 单机限流（生产可替换为 Redis 实现） ───────────────────────

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new BusinessException(BizCode.RATE_LIMITED, '请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** 登录接口防暴力破解：按 IP + 邮箱双键限流。 */
export function loginRateLimit(ip: string, email: string, max: number, windowMs: number): void {
  rateLimit(`login:ip:${ip}`, max, windowMs);
  rateLimit(`login:email:${email.toLowerCase()}`, Math.max(3, Math.floor(max / 2)), windowMs);
}
