import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * 订单创建 / 取消 / 核销统一走可串行化事务，配合 Inventory.version 乐观锁防超卖。
   * Prisma 的 interactive transaction 保证同一事务内读写一致。
   */
  async withSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10_000,
          maxWait: 5_000,
        });
      } catch (error) {
        if (attempt >= 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 10));
      }
    }
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
