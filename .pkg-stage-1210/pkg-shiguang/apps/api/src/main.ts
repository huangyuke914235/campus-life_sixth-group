import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter, RequestIdInterceptor } from './common';
import { csrfMiddleware } from './common/csrf';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });
  const config = app.get(ConfigService);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  // CSRF 在 Cookie 解析之后、路由之前；仅对写请求生效
  app.use(csrfMiddleware(config.get('CSRF_ENABLED') === 'true'));
  // 菜品图片：本地存储模式下直接由 API 提供 /uploads/*（生产可改 S3 + CDN）
  app.useStaticAssets(resolve(config.get<string>('STORAGE_LOCAL_DIR') || './uploads'), {
    prefix: '/uploads/',
    maxAge: '7d',
    index: false,
  });
  app.enableCors({
    origin: (config.get('WEB_ORIGIN') || 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix(config.get('API_PREFIX') || '/api/v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('食光有数 · 开放 API')
    .setDescription('校园食堂菜品评价与预约取餐平台。演示模式下支付、营养数据均为标注过的模拟/估算数据。')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = Number(config.get('API_PORT') || 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${port}, prefix ${config.get('API_PREFIX') || '/api/v1'}, swagger /docs`);
}

void bootstrap();
