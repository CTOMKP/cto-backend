import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// PrismaService wraps PrismaClient for NestJS DI and lifecycle hooks
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Initialize connection on module init
  async onModuleInit() {
    await this.$connect();
  }

  // Gracefully close connection on shutdown
  async onModuleDestroy() {
    await this.$disconnect();
  }
}