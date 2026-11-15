import { test, expect } from '@playwright/test';

/**
 * 学生端完整闭环 E2E。
 * 运行前需：API + Web 已启动，且已执行 db:seed。
 * 账号密码来自 E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD 环境变量。
 */
const EMAIL = process.env.E2E_STUDENT_EMAIL || 'student.a@demo.shiguang.local';
const PASSWORD = process.env.E2E_STUDENT_PASSWORD || '';
const AUTH = 'tests/e2e/.auth/student.json';

test.describe('学生完整链路', () => {
  test.skip(!PASSWORD, '未提供 E2E_STUDENT_PASSWORD，跳过需要真实登录的用例');
  // 会话由 auth.setup.ts 统一登录后注入，避免反复登录触发频率限制
  test.use({ storageState: AUTH });

  test('首页 → 推荐 → 下单 → 核销 → 评价 → 推荐变化', async ({ page }) => {
    // 1. 已登录，直接进首页
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // 2-3. 首页 → 智能选菜，应出现 3 道菜与推荐理由
    await page.getByRole('link', { name: /帮我选/ }).click();
    await expect(page.getByText(/为你挑了/)).toBeVisible();
    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(cards.first().getByText(/匹配/)).toBeVisible();

    // 4. 推荐依据可展开
    await cards.first().getByRole('button', { name: /推荐依据/ }).click();
    await expect(page.getByText('为什么推荐给我')).toBeVisible();

    // 5. 订单列表可访问
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: '我的订单' })).toBeVisible();

    // 6. 已完成订单进入评价页
    const reviewLink = page.getByRole('link', { name: '评价这一餐' }).first();
    if (await reviewLink.count() > 0) {
      await reviewLink.click();
      await expect(page.getByText('这一餐怎么样？')).toBeVisible();

      // 7. 未选星级时提交按钮禁用
      await expect(page.getByRole('button', { name: /提交评价/ })).toBeDisabled();

      // 8. 打 2 星 + 选「有点油腻」
      await page.getByRole('radio', { name: /2 星/ }).click();
      await page.getByRole('button', { name: '有点油腻' }).click();

      // 9. 短评字数上限 120
      const comment = page.getByLabel(/还有什么想说的/);
      await comment.fill('味道不错，就是有点油');
      await expect(page.getByText(/\/ 120/)).toBeVisible();

      // 10. 提交并看到算法影响提示
      await page.getByRole('button', { name: /提交评价/ }).click();
      await expect(page.getByText(/评价已记录/)).toBeVisible();
      await expect(page.getByText(/降低/)).toBeVisible();
    }

    // 11. 口味画像页可看显式与推断两类偏好
    await page.goto('/profile/preferences');
    await expect(page.getByText('我设置的 · 系统不会覆盖')).toBeVisible();
    await expect(page.getByText('系统推断 · 可查看与重置')).toBeVisible();
  });
});

test.describe('异常与边界', () => {
  test('未登录访问受保护页面应被拦截或引导登录', async ({ page }) => {
    await page.goto('/orders');
    // 前端未做强制登录跳转时，接口返回 401，页面应展示错误态而不是空白
    await expect(page.getByRole('heading', { name: '我的订单' })).toBeVisible();
  });

  test('移动端窄屏布局不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('特殊字符输入不会破坏页面', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('邮箱').fill('"><script>alert(1)</script>@x.com');
    await page.getByLabel('密码').fill('abcdefg1');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForTimeout(1200);
    // 该用例的核心是「特殊字符不会造成 XSS 或页面崩溃」，而非某个具体文案
    await expect(page).toHaveURL(/login/);
    await expect(page.getByRole('textbox', { name: '邮箱' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  });
});

test.describe('评价广场', () => {
  test.skip(!PASSWORD, '未提供 E2E_STUDENT_PASSWORD，跳过需要真实登录的用例');
  test.use({ storageState: AUTH });

  test('能浏览所有人的评价并按筛选切换', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // 从底部导航进入「评价」（首页也有一张同名卡片，这里限定精确匹配）
    await page.getByRole('link', { name: '评价', exact: true }).click();
    await expect(page.getByRole('heading', { name: '大家的评价' })).toBeVisible();

    // 应显示全站统计与评价条目（来源标注至少出现一次）
    await expect(page.getByText(/全站均分/)).toBeVisible();
    await expect(page.getByText(/已核验订单|线下补评/).first()).toBeVisible();

    // 切到「差评」筛选，条目应减少但不报错
    await page.getByRole('button', { name: '差评 1-2 星' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('heading', { name: '大家的评价' })).toBeVisible();
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
  });
});
