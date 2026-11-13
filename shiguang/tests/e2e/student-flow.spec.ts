import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createStudentFlowFixture, withFixtureDb } from '../../apps/api/scripts/e2e-fixture';

type Fixture = Awaited<ReturnType<typeof createStudentFlowFixture>>;

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(process.env.E2E_DEMO_PASSWORD!);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(landing);
}

async function csrf(request: APIRequestContext) {
  const { cookies } = await request.storageState();
  const token = cookies.find((cookie) => cookie.name === 'csrf_token')?.value;
  expect(token, '登录应下发 CSRF Cookie').toBeTruthy();
  return { 'X-CSRF-Token': token! };
}

test.describe('隔离环境预约流程', () => {
  let fixture: Fixture;
  test.beforeAll(async ({ baseURL }, testInfo) => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
    fixture = await createStudentFlowFixture(testInfo.project.name);
  });

  test('预约、备餐、核销、评价和推荐变化', async ({ page, browser, baseURL }) => {
    await login(page, fixture.studentEmail, /\/dashboard$/);
    const recommendation = async () => {
      const response = await page.request.post('/api/v1/recommendations/query', {
        headers: await csrf(page.request),
        data: { mealType: fixture.mealType, budgetMinCents: fixture.priceCents, budgetMaxCents: fixture.priceCents },
      });
      expect(response.status()).toBe(201);
      const body = await response.json();
      const item = body.data.items.find((row: { dishId: string }) => row.dishId === fixture.dishId);
      expect(item, '固定价格区间内的预约菜品应进入推荐').toBeTruthy();
      return item as { score: number; reason: string };
    };
    const before = await recommendation();

    await page.goto('/dishes/' + fixture.dishId);
    await page.getByRole('button', { name: /加入点餐清单/ }).click();
    await page.goto('/cart');
    await page.getByRole('link', { name: /去结算/ }).click();
    await page.getByLabel('取餐日期').fill(fixture.nextDate);
    await page.getByLabel('取餐餐次').selectOption(fixture.mealType);
    await page.getByRole('button', { name: /11:50.*12:10/ }).click();
    const created = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/orders' && response.request().method() === 'POST');
    await page.getByRole('button', { name: /确认下单/ }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const { data: { order } } = await createdResponse.json();
    expect(order.status).toBe('PENDING');
    await expect(page).toHaveURL(/\/orders$/);
    await withFixtureDb(async (db) => {
      const inventory = await db.inventory.findUniqueOrThrow({
        where: { dishId_date_mealType: { dishId: fixture.dishId, date: fixture.pickupDate, mealType: fixture.mealType } },
      });
      const slot = await db.pickupSlot.findUniqueOrThrow({ where: { id: fixture.slotId } });
      expect(inventory.remaining).toBe(5);
      expect(slot.booked).toBe(1);
    });

    const staff = await browser.newContext({ baseURL });
    try {
      const merchant = await staff.newPage();
      await login(merchant, fixture.merchantEmail, /\/admin$/);
      await merchant.goto('/admin/orders');
      await merchant.getByLabel('订单日期').fill(fixture.nextDate);
      const card = merchant.locator('article').filter({ hasText: order.number });
      for (const action of ['接单', '开始备餐', '备好了']) {
        await card.getByRole('button', { name: action, exact: true }).click();
      }
      await expect(card.getByText('待取餐', { exact: true })).toBeVisible();

      await page.goto('/orders/' + order.id);
      const tokenCard = page.locator('section').filter({ has: page.getByRole('heading', { name: '取餐凭证' }) });
      const tokenLabel = tokenCard.getByText(/^\d{6}$/);
      await expect(tokenLabel).toBeVisible();
      const code = (await tokenLabel.textContent())!.trim();
      await merchant.getByLabel('取餐码').fill(code);
      await merchant.getByRole('button', { name: '核销', exact: true }).click();
      await expect(merchant.getByText(/核销成功/)).toBeVisible();
      const repeated = await staff.request.post('/api/v1/pickup/verify', {
        headers: await csrf(staff.request), data: { code, stallId: fixture.stallId },
      });
      expect(repeated.status()).toBe(400);
    } finally {
      await staff.close();
    }

    await page.reload();
    await expect(page.getByRole('heading', { name: '已完成' })).toBeVisible();
    await page.getByRole('link', { name: /评价「/ }).click();
    await page.getByRole('radio', { name: /^2 分/ }).click();
    await page.getByRole('button', { name: '有点油腻', exact: true }).click();
    await page.getByRole('button', { name: /提交评价/ }).click();
    await expect(page.getByText(/评价已记录/)).toBeVisible();
    await withFixtureDb(async (db) => {
      const stored = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { pickupToken: true, reviews: true } });
      expect(stored.status).toBe('COMPLETED');
      expect(stored.pickupToken?.status).toBe('USED');
      expect(stored.reviews.map(({ rating, source }) => ({ rating, source }))).toEqual([{ rating: 2, source: 'VERIFIED_ORDER' }]);
    });
    const after = await recommendation();
    expect(after.reason).toContain('打过低分');
    expect(after.score).toBeLessThan(before.score);
  });

  test('未登录和跨档口请求被拒绝，额外字段不写入', async ({ request }) => {
    expect((await request.get('/api/v1/orders')).status()).toBe(401);
    const loginResponse = await request.post('/api/v1/auth/login', {
      data: { email: fixture.merchantEmail, password: process.env.E2E_DEMO_PASSWORD },
    });
    expect(loginResponse.status()).toBe(201);
    const headers = await csrf(request);
    const dishPath = '/api/v1/dishes/' + fixture.dishId;
    const withoutCsrf = await request.patch(dishPath, { data: { name: '无效修改' } });
    expect(withoutCsrf.status()).toBe(403);
    const extraField = await request.patch(dishPath, { headers, data: { avgRating: 10 } });
    expect(extraField.status()).toBe(400);
    const outside = await request.patch('/api/v1/dishes/' + fixture.otherDishId, { headers, data: { name: '无效修改' } });
    expect(outside.status()).toBe(403);
    const allowed = await request.patch(dishPath, { headers, data: { description: '隔离环境编辑验证' } });
    expect(allowed.status()).toBe(200);
    await withFixtureDb(async (db) => {
      const dish = await db.dish.findUniqueOrThrow({ where: { id: fixture.dishId } });
      expect(dish.avgRating).not.toBe(10);
      expect(dish.name).toMatch(/^测试鸡肉饭/);
    });
  });

  test('窄屏首页不横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
