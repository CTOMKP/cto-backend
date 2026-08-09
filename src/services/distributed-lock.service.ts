import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  async acquire(name: string, ttlMs: number): Promise<string | null> {
    const owner = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    try {
      await (this.prisma as any).jobLease.create({
        data: { name, owner, expiresAt },
      });
      return owner;
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
    }

    const takeover = await (this.prisma as any).jobLease.updateMany({
      where: { name, expiresAt: { lt: now } },
      data: { owner, expiresAt },
    });
    return takeover.count === 1 ? owner : null;
  }

  async release(name: string, owner: string): Promise<void> {
    try {
      await (this.prisma as any).jobLease.deleteMany({ where: { name, owner } });
    } catch (error: any) {
      this.logger.warn(`Failed to release job lease ${name}: ${error.message}`);
    }
  }
}
