import { describe, expect, it, vi } from 'vitest';
import { BizCode, BusinessException, Errors, rateLimit, sanitize, assertStallScope, assertOwnerOrAdmin, type AuthUser } from './index';

const merchant: AuthUser = { id: 'u1', email: 'm@x.com', role: 'MERCHANT', displayName: '王师傅', stallIds: ['s1'] };
const student: AuthUser = { id: 'u2', email: 's@x.com', role: 'STUDENT', displayName: '林小满' };
const admin: AuthUser = { id: 'u3', email: 'a@x.com', role: 'ADMIN', displayName: '管理员' };

describe('日志脱敏', () => {
  it('密码、令牌、Cookie、幂等键都不出现在日志里', () => {
    const out = sanitize({
      email: 'a@b.com',
      password: 'p@ssw0rd',
      passwordHash: '$argon2id$...',
      accessToken: 'aaa.bbb.ccc',
      refresh_token: 'xxx',
      idempotencyKey: 'idem-1',
      headers: { Authorization: 'Bearer abc', cookie: 'access_token=abc' },
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    expect(out.passwordHash).toBe('[REDACTED]');
    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
    expect(out.idempotencyKey).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('p@ssw0rd');
    expect(JSON.stringify(out)).not.toContain('Bearer abc');
  });

  it('嵌套对象与数组同样脱敏，且限制递归深度', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } };
    const out = sanitize(deep);
    expect(JSON.stringify(out)).toContain('[depth]');
    const arr = sanitize([{ password: 'x' }, { ok: 1 }]) as Record<string, unknown>[];
    expect(arr[0].password).toBe('[REDACTED]');
    expect(arr[1].ok).toBe(1);
  });
});

describe('业务错误码', () => {
  it('各类错误映射到约定的 code 与 HTTP 状态', () => {
    expect(Errors.unauthorized()).toBeInstanceOf(BusinessException);
    expect((Errors.unauthorized() as BusinessException).bizCode).toBe(BizCode.UNAUTHORIZED);
    expect((Errors.forbidden() as BusinessException).getStatus()).toBe(403);
    expect((Errors.inventoryConflict() as BusinessException).bizCode).toBe(BizCode.INVENTORY_CONFLICT);
    expect((Errors.duplicateReview() as BusinessException).getStatus()).toBe(409);
    expect((Errors.duplicateOrder() as BusinessException).bizCode).toBe(BizCode.DUPLICATE_ORDER);
    expect((Errors.slotFull() as BusinessException).bizCode).toBe(BizCode.SLOT_FULL);
    expect((Errors.tokenInvalid() as BusinessException).bizCode).toBe(BizCode.TOKEN_INVALID);
    expect((Errors.invalidParam('x') as BusinessException).bizCode).toBe(BizCode.INVALID_PARAM);
  });
});

describe('限流', () => {
  it('超过窗口内次数抛 429 业务异常，窗口重置后恢复', () => {
    vi.useFakeTimers();
    const key = `test:${Math.random()}`;
    expect(() => { for (let i = 0; i < 3; i += 1) rateLimit(key, 3, 1000); }).not.toThrow();
    try {
      rateLimit(key, 3, 1000);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as BusinessException).bizCode).toBe(BizCode.RATE_LIMITED);
      expect((e as BusinessException).getStatus()).toBe(429);
    }
    vi.advanceTimersByTime(1100);
    expect(() => rateLimit(key, 3, 1000)).not.toThrow();
    vi.useRealTimers();
  });
});

describe('数据边界（后端强制）', () => {
  it('商户只能操作被授权档口，越权抛 403', () => {
    expect(() => assertStallScope(merchant, 's1')).not.toThrow();
    expect(() => assertStallScope(merchant, 's2')).toThrow();
    expect(() => assertStallScope(admin, 'anything')).not.toThrow();
    expect(() => assertStallScope(student, 's1')).toThrow();
  });

  it('学生只能访问自己的订单，管理员可越权查看', () => {
    expect(() => assertOwnerOrAdmin(student, student.id)).not.toThrow();
    expect(() => assertOwnerOrAdmin(student, 'other-user')).toThrow();
    expect(() => assertOwnerOrAdmin(admin, 'other-user')).not.toThrow();
  });
});
