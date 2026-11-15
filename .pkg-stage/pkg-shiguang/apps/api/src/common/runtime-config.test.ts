import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtime-config';

const production = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  COOKIE_SECURE: 'true',
  CSRF_ENABLED: 'true',
  ENABLE_DEMO_ACCOUNTS: 'false',
  SEED_DEMO_DATA: 'false',
};

describe('生产启动配置', () => {
  it('接受安全配置和本地开发配置', () => {
    expect(validateRuntimeConfig(production)).toBe(production);
    expect(validateRuntimeConfig({ NODE_ENV: 'development' })).toEqual({ NODE_ENV: 'development' });
  });

  it.each([
    ['COOKIE_SECURE', 'false'],
    ['CSRF_ENABLED', 'false'],
    ['ENABLE_DEMO_ACCOUNTS', 'true'],
    ['SEED_DEMO_DATA', 'true'],
    ['JWT_ACCESS_SECRET', 'CHANGE_ME_ACCESS_SECRET'],
    ['JWT_REFRESH_SECRET', production.JWT_ACCESS_SECRET],
  ])('拒绝不安全的 %s，错误不含配置值', (key, value) => {
    const expected = new RegExp(key);
    expect(() => validateRuntimeConfig({ ...production, [key]: value })).toThrow(expected);
    if (key.startsWith('JWT_')) {
      expect(() => validateRuntimeConfig({ ...production, [key]: value })).not.toThrow(value);
    }
  });
});
