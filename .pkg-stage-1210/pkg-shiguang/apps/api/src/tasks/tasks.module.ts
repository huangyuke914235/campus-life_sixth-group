/**
 * 订单超时任务（BullMQ）：每 5 分钟扫描超过 2 小时仍未完成的订单，
 * 置为 EXPIRED 并恢复库存与取餐名额，同时给学生发通知。
 *
 * Redis 不可用时只告警、不阻塞启动——核心下单链路不依赖队列。
 */
import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

const QUEUE_NAME = 'shiguang-orders';
const JOB_NAME = 'expire-stale-orders';
const INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const HOLDING = ['PENDING', 'CONFIRMED', 'PREPARING'];

interface RedisConn { host: string; port: number; password?: string }

function parseRedis(url: string): RedisConn {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

@Injectable()
export class OrdersTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersTask.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('未配置 REDIS_URL，订单超时任务未启用');
      return;
    }
    try {
      const connection = parseRedis(redisUrl);
      this.queue = new Queue(QUEUE_NAME, { connection });
      this.worker = new Worker(QUEUE_NAME, (job: Job) => this.handle(job), { connection, concurrency: 1 });
      this.worker.on('failed', (job, err) => this.logger.error(`任务 ${job?.name} 失败：${err.message}`));

      await this.queue.add(JOB_NAME, {}, {
        repeat: { every: INTERVAL_MS },
        jobId: 'expire-stale-orders',
        removeOnComplete: 20,
        removeOnFail: 20,
      });
      this.logger.log(`订单超时任务已启动：每 ${INTERVAL_MS / 60000} 分钟扫描一次，超过 ${STALE_AFTER_MS / 3600000} 小时未完成即置为已过期`);
    } catch (e) {
      this.logger.warn(`Redis 不可用，订单超时任务未启用：${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  private async handle(job: Job): Promise<unknown> {
    if (job.name !== JOB_NAME) return { skipped: true };
    return this.expireStale();
  }

  /** 可被单测/手动调用：把超时订单置为 EXPIRED 并回滚库存与名额。 */
  async expireStale(now = new Date()): Promise<{ expired: number; orders: string[] }> {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const stale = await this.prisma.order.findMany({
      where: { status: { in: HOLDING as never[] }, createdAt: { lt: cutoff } },
      include: { items: true },
      take: 100,
    });

    const expired: string[] = [];
    for (const order of stale) {
      await this.prisma.withSerializable(async (tx) => {
        // 条件更新：只有仍处于占用库存的状态才回滚，避免与并发完成/取消打架
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: { in: HOLDING as never[] } },
          data: { status: 'EXPIRED', cancelledReason: '超时未取餐，系统自动关闭' },
        });
        if (claimed.count !== 1) return;
        for (const item of order.items) {
          await tx.inventory.updateMany({
            where: { dishId: item.dishId, date: order.scheduledDate, mealType: order.mealType },
            data: { remaining: { increment: item.quantity }, version: { increment: 1 } },
          });
        }
        await tx.pickupSlot.updateMany({ where: { id: order.pickupSlotId }, data: { booked: { decrement: 1 } } });
        await tx.notification.create({
          data: { userId: order.userId, type: 'ORDER_CANCELLED', title: '订单已超时关闭', body: `订单 ${order.number} 超过 2 小时未完成，已自动关闭并释放库存。` },
        });
        expired.push(order.number);
      });
    }

    if (expired.length > 0) this.logger.log(`订单超时任务：关闭 ${expired.length} 个订单`);
    return { expired: expired.length, orders: expired };
  }
}

@Module({ providers: [OrdersTask], exports: [OrdersTask] })
export class TasksModule {}
