/**
 * 应用启动冒烟测试（不依赖数据库）
 *
 * 为什么不用 vitest 跑：vitest 基于 esbuild 转译，不生成 emitDecoratorMetadata，
 * NestJS 的构造器注入会全部拿到 undefined。因此这里直接使用 `nest build` 的
 * tsc 编译产物（含元数据），再交给 @nestjs/testing + supertest 验证。
 *
 * 运行：node apps/api/scripts/smoke.js（先 npm run build）
 */
process.env.NODE_ENV = 'test';

const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const request = require('supertest');

const prismaMock = {
  $connect: async () => undefined,
  $disconnect: async () => undefined,
  $transaction: async (fn) => (typeof fn === 'function' ? fn(prismaMock) : []),
  user: { findUnique: async () => null, findMany: async () => [], count: async () => 0 },
  order: { findMany: async () => [], count: async () => 0 },
  dish: { findMany: async () => [] },
};

async function main() {
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { AllExceptionsFilter, RequestIdInterceptor } = require('../dist/common');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('/api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());
  await app.init();

  const server = app.getHttpServer();
  const results = [];

  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ 结果: 'PASS', 用例: name });
    } catch (e) {
      results.push({ 结果: 'FAIL', 用例: name, 原因: e.message });
    }
  };

  await check('GET /health 返回 200 与统一响应结构', async () => {
    const res = await request(server).get('/api/v1/health');
    if (res.status !== 200) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    if (res.body.code !== 0) throw new Error(`code=${res.body.code}`);
    if (res.body.data?.status !== 'ok') throw new Error('data.status 不是 ok');
    if (typeof res.body.requestId !== 'string') throw new Error('缺少 requestId');
  });

  await check('未登录访问 /orders 返回 401 + 错误码 10002', async () => {
    const res = await request(server).get('/api/v1/orders');
    if (res.status !== 401) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    if (res.body.code !== 10002) throw new Error(`code=${res.body.code}`);
    if (!res.body.timestamp) throw new Error('缺少 timestamp');
  });

  await check('非法邮箱登录返回 400 且不泄露堆栈', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    if (res.status !== 400) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
    if (res.body.code !== 10001) throw new Error(`code=${res.body.code}`);
    if (JSON.stringify(res.body).includes('stack')) throw new Error('响应里出现了堆栈');
  });

  await check('未声明字段被拒绝（forbidNonWhitelisted）', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({ email: 'a@b.com', password: '12345678', isAdmin: true });
    if (res.status !== 400) throw new Error(`status=${res.status} body=${JSON.stringify(res.body)}`);
  });

  await check('演示账号接口不泄露明文密码', async () => {
    const res = await request(server).get('/api/v1/auth/demo-accounts');
    if (res.status !== 200) throw new Error(`status=${res.status}`);
    if (res.body.data?.enabled === false && (res.body.data.accounts ?? []).length > 0) throw new Error('关闭演示时仍返回了账号');
    if (JSON.stringify(res.body).toLowerCase().includes('passwordHash')) throw new Error('返回体包含密码哈希字段');
  });

  await check('不存在的路由返回 404 且格式统一', async () => {
    const res = await request(server).get('/api/v1/not-exist');
    if (res.status !== 404) throw new Error(`status=${res.status}`);
    if (res.body.code !== 10004) throw new Error(`code=${res.body.code}`);
  });

  await app.close();

  console.table(results);
  const failed = results.filter((r) => r.结果 === 'FAIL');
  console.log(`\n冒烟结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('冒烟测试启动失败：', e);
  process.exitCode = 1;
});
