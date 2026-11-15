import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // 先登录一次并保存会话，避免多个用例反复登录触发登录频率限制
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] }, dependencies: ['setup'] },
  ],
});
