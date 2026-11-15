import type { ConfigService } from '@nestjs/config';

const DEMO_EMAIL_DOMAIN = '@demo.shiguang.local';
const DEMO_EMAIL_KEYS = ['DEMO_STUDENT_A_EMAIL', 'DEMO_STUDENT_B_EMAIL', 'DEMO_MERCHANT_EMAIL', 'DEMO_ADMIN_EMAIL'];

export function demoAccountsEnabled(config: Pick<ConfigService, 'get'>): boolean {
  return config.get('ENABLE_DEMO_ACCOUNTS') === 'true'
    && (config.get('NODE_ENV') !== 'production' || config.get('ALLOW_DEMO_ACCOUNTS') === 'true');
}

export function isDemoAccountEmail(email: string, config: Pick<ConfigService, 'get'>): boolean {
  const normalized = email.toLowerCase();
  return normalized.endsWith(DEMO_EMAIL_DOMAIN)
    || DEMO_EMAIL_KEYS.some((key) => config.get<string>(key)?.trim().toLowerCase() === normalized);
}
