import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import { validateRuntimeConfig } from '../common/runtime-config';
import { AuthService, type PasswordService } from './auth.module';

const production = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  COOKIE_SECURE: 'true',
  CSRF_ENABLED: 'true',
  SEED_DEMO_DATA: 'false',
};
const student = {
  id: 'fixture-student',
  email: 'student.a@demo.shiguang.local',
  displayName: '演示学生',
  role: 'STUDENT',
  isActive: true,
  privacyDeleteAt: null,
  passwordHash: 'fixture-hash',
};

function authWith(config: Record<string, string>) {
  const db = {
    user: {
      findMany: vi.fn().mockResolvedValue([student]),
      findUnique: vi.fn().mockResolvedValue(student),
      update: vi.fn(),
    },
    refreshToken: { create: vi.fn() },
  };
  const passwords = { verify: vi.fn().mockResolvedValue(true) };
  const jwt = { signAsync: vi.fn().mockResolvedValue('fixture-token'), decode: vi.fn().mockReturnValue({ exp: 2_000_000_000 }) };
  const service = new AuthService(
    db as unknown as PrismaService,
    passwords as unknown as PasswordService,
    jwt as unknown as JwtService,
    { get: (key: string) => config[key] } as ConfigService,
  );
  const req = { headers: {}, ip: student.id + Object.values(config).join('-') } as Request;
  const res = { cookie: vi.fn() } as unknown as Response;
  return { service, db, req, res };
}

describe('演示账号显示与登录', () => {
  it.each([
    { NODE_ENV: 'production', ENABLE_DEMO_ACCOUNTS: 'false', ALLOW_DEMO_ACCOUNTS: 'true' },
    { NODE_ENV: 'production', ENABLE_DEMO_ACCOUNTS: 'true', ALLOW_DEMO_ACCOUNTS: 'false' },
    { NODE_ENV: 'development', ENABLE_DEMO_ACCOUNTS: 'false', ALLOW_DEMO_ACCOUNTS: 'false' },
  ])('显示与登录均关闭（$NODE_ENV $ENABLE_DEMO_ACCOUNTS $ALLOW_DEMO_ACCOUNTS）', async (config) => {
    const { service, db, req, res } = authWith(config);
    await expect(service.demoAccounts()).resolves.toEqual({ enabled: false, accounts: [] });
    expect(db.user.findMany).not.toHaveBeenCalled();
    await expect(service.login({ email: student.email, password: 'fixture-password' }, req, res))
      .rejects.toMatchObject({ status: 401 });
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('已授权的生产模式演示站展示并登录原账号，保留账号 ID', async () => {
    const config = { ...production, ENABLE_DEMO_ACCOUNTS: 'true', ALLOW_DEMO_ACCOUNTS: 'true' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(validateRuntimeConfig(config)).toEqual(config);
    } finally {
      warn.mockRestore();
    }
    const { service, db, req, res } = authWith(config);
    await expect(service.demoAccounts()).resolves.toMatchObject({
      enabled: true, accounts: [{ email: student.email, role: 'STUDENT' }],
    });
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, privacyDeleteAt: null }),
    }));
    await expect(service.login({ email: student.email, password: 'fixture-password' }, req, res))
      .resolves.toMatchObject({ id: student.id, email: student.email });
    expect(db.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: student.id }),
    }));
    await expect(service.register({ email: 'reserved@demo.shiguang.local', displayName: '占位', password: 'fixture-password' }, req, res))
      .rejects.toMatchObject({ status: 400 });
  });
});
