/**
 * 订单超时任务（BullMQ）：每 5 分钟关闭超过取餐时段的未完成订单。
 *
 * Redis 不可用时只告警、不阻塞启动——核心下单链路不依赖队列。
 */
import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { campusClock, campusDate, campusTime, canTransition, ORDER_STATUSES, parseCampusDate } from '@shiguang/shared';
import { closeOrder } from '../orders/order-lifecycle';
import { PrismaService } from '../prisma/prisma.service';

const QUEUE_NAME = 'shiguang-orders';
const JOB_NAME = 'expire-stale-orders';
const INTERVAL_MS = 5 * 60 * 1000;
const EXPIRABLE = ORDER_STATUSES.filter((status) => canTransition(status, 'EXPIRED'));
const BATCH_SIZE = 100;

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
  private lastSuccessfulScanAt: string | null = null;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  getLastSuccessfulScanAt(): string | null {
    return this.lastSuccessfulScanAt;
  }

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
      this.logger.log(`订单超时任务已启动：每 ${INTERVAL_MS / 60000} 分钟扫描已结束的取餐时段`);
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

  /** 取餐时段结束后关闭订单，释放名额和未用于备餐的库存。 */
  async expireStale(now = new Date()): Promise<{ expired: number; orders: string[] }> {
    const date = parseCampusDate(campusDate(now))!;
    const time = campusClock(now);
    const expired: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const stale = await this.prisma.order.findMany({
        where: {
          id: cursor ? { gt: cursor } : undefined,
          status: { in: EXPIRABLE },
          pickupSlot: { OR: [{ date: { lt: date } }, { date, endTime: { lte: time } }] },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      for (const row of stale) {
        const closed = await this.prisma.withSerializable(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: row.id }, include: { items: true, pickupSlot: true },
          });
          if (!order) return undefined;
          const deadline = campusTime(order.pickupSlot.date.toISOString().slice(0, 10), order.pickupSlot.endTime);
          if (!deadline || now < deadline) return undefined;
          const claimed = await closeOrder(tx, order, 'EXPIRED', now, '超时未取餐，系统自动关闭');
          return claimed ? order.number : undefined;
        });
        if (closed) expired.push(closed);
      }
      if (stale.length < BATCH_SIZE) break;
      cursor = stale[stale.length - 1].id;
    }

    this.lastSuccessfulScanAt = new Date().toISOString();
    if (expired.length > 0) this.logger.log(`订单超时任务：关闭 ${expired.length} 个订单`);
    return { expired: expired.length, orders: expired };
  }
}

@Module({ providers: [OrdersTask], exports: [OrdersTask] })
export class TasksModule {}
