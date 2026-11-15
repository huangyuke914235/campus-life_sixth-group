import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { resolve } from 'node:path';

import { PrismaModule } from './prisma/prisma.service';
import { JwtAuthGuard } from './auth/auth.module';
import { Public, RolesGuard, ok } from './common';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CanteensModule } from './canteens/canteens.module';
import { StallsModule } from './stalls/stalls.module';
import { DishesModule } from './dishes/dishes.module';
import { MenusModule } from './menus/menus.module';
import { PreferencesModule } from './preferences/preferences.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { OrdersModule } from './orders/orders.module';
import { PickupModule } from './pickup/pickup.module';
import { ReviewsModule } from './reviews/reviews.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { FavoritesModule } from './favorites/favorites.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { UploadsModule } from './uploads/uploads.module';
import { TasksModule } from './tasks/tasks.module';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return ok({ status: 'ok', service: 'shiguang-api', time: new Date().toISOString() });
  }
}

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
      cache: false,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CanteensModule,
    StallsModule,
    DishesModule,
    MenusModule,
    PreferencesModule,
    RecommendationsModule,
    OrdersModule,
    PickupModule,
    ReviewsModule,
    NutritionModule,
    FavoritesModule,
    NotificationsModule,
    AnalyticsModule,
    AdminModule,
    UploadsModule,
    TasksModule,
  ],
  providers: [
    // 顺序重要：先解析身份，再校验角色
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
