import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// PrismaService wraps PrismaClient for NestJS DI and lifecycle hooks
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Initialize connection on module init
  async onModuleInit() {
    // Short timeout in dev to avoid long startup hangs
    const timeoutMs = process.env.NODE_ENV === 'production' ? 10000 : 2000;
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Prisma connect timeout')), timeoutMs)),
      ]);
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        // Log and continue; services depending on DB should handle unavailable state gracefully
        console.warn('[Prisma] Skipping DB connection during dev startup:', (e as Error).message);
        return;
      }
      throw e;
    }
  }

  // Gracefully close connection on shutdown
  async onModuleDestroy() {
    await this.$disconnect();
  }
}