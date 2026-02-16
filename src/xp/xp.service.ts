import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class XpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getBalance(userId: number) {
    await this.awardDailyLogin(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.xpBalance ?? 0;
  }

  async award(userId: number, amount: number, reason: string, metadata?: any) {
    if (amount <= 0) return null;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');
      const nextBalance = (user.xpBalance || 0) + amount;
      await tx.user.update({
        where: { id: userId },
        data: { xpBalance: nextBalance },
      });
      const record = await tx.xpTransaction.create({
        data: {
          userId,
          type: 'EARN',
          reason,
          amount,
          balanceAfter: nextBalance,
          metadata: metadata ?? undefined,
        },
      });
      await this.notifications.createNotification({
        userId,
        type: 'XP',
        title: `+${amount} XP`,
        body: `XP earned: ${reason}`,
        data: { reason, amount, balance: nextBalance },
      });
      return record;
    });
  }

  async spend(userId: number, amount: number, reason: string, metadata?: any) {
    if (amount <= 0) return null;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new BadRequestException('User not found');
      const current = user.xpBalance || 0;
      if (current < amount) {
        throw new BadRequestException('Insufficient XP');
      }
      const nextBalance = current - amount;
      await tx.user.update({
        where: { id: userId },
        data: { xpBalance: nextBalance },
      });
      const record = await tx.xpTransaction.create({
        data: {
          userId,
          type: 'SPEND',
          reason,
          amount,
          balanceAfter: nextBalance,
          metadata: metadata ?? undefined,
        },
      });
      await this.notifications.createNotification({
        userId,
        type: 'XP',
        title: `-${amount} XP`,
        body: `XP spent: ${reason}`,
        data: { reason, amount, balance: nextBalance },
      });
      return record;
    });
  }

  async awardSignup(userId: number) {
    return this.award(userId, 8, 'signup');
  }

  async awardCreateAd(userId: number, adId: string) {
    return this.award(userId, 2, 'create_ad', { adId });
  }

  async awardCreateListing(userId: number, listingId: string) {
    return this.award(userId, 2, 'create_listing', { listingId });
  }

  async awardFundWallet(userId: number, amount?: number) {
    return this.award(userId, 3, 'fund_wallet', { amount });
  }

  async awardShareAd(userId: number, adId: string) {
    return this.award(userId, 2, 'share_ad', { adId });
  }

  async awardDailyLogin(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const now = new Date();
    const last = user.lastDailyXpAt;
    if (last) {
      const sameDay = last.toDateString() === now.toDateString();
      if (sameDay) return null;
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastDailyXpAt: now },
    });
    return this.award(userId, 1, 'daily_login');
  }
}
