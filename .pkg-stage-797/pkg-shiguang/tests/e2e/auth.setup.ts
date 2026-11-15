import { test as setup, expect } from '@playwright/test';

/**
 * 只登录一次，把 Cookie 存成 storageState 供其它用例复用。
 * 这样 E2E 不会因为反复登录触发登录频率限制。
 * 需要「未登录」状态的用例不要引用这个文件。
 */
const EMAIL = process.env.E2E_STUDENT_EMAIL || 'student.a@demo.shiguang.local';
const PASSWORD = process.env.E2E_STUDENT_PASSWORD || '';

setup.skip(!PASSWORD, '未提供 E2E_STUDENT_PASSWORD，跳过登录初始化');

setup('登录并保存会话', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(EMAIL);
  await page.getByLabel('密码').fill(PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: 'tests/e2e/.auth/student.json' });
});
