import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ACCOUNT_AGE_MILESTONES,
  XP_CAPPED_REASONS,
  XP_DAILY_CAP,
  XP_REASONS,
  XP_VALUES,
  RS_REASONS,
  RANK_SCORE_VALUES,
  RANK_TIERS,
  getRankTierForScore,
} from './xp.constants';

type TxClient = Prisma.TransactionClient;

interface UserRewardState {
  id: number;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
  xpBalance: number;
  rankScore: number;
  rankTier: number;
  currentStreakDays: number;
  lastLoginDate: Date | null;
  lastDailyXpAt: Date | null;
}

interface GetUserProgressOptions {
  awardDailyLogin?: boolean;
}

interface AwardXpOptions {
  eventKey?: string;
  metadata?: Prisma.InputJsonObject;
  countsTowardDailyCap?: boolean;
  notify?: boolean;
}

interface AwardRankOptions {
  eventKey?: string;
  metadata?: Prisma.InputJsonObject;
  notifyTierChange?: boolean;
}

export interface UserRewardProgress {
  xpBalance: number;
  rankScore: number;
  rankTier: number;
  rankLevel: number;
  rankLabel: string;
  rankEmoji: string;
  daysOnPlatform: number;
  currentStreakDays: number;
  nextRankTier: number | null;
  nextRankLevel: number | null;
  nextRankLabel: string | null;
  progressPercent: number;
  scoreProgressPercent: number;
  dayProgressPercent: number;
  rankScoreToNext: number;
  daysToNext: number;
}

@Injectable()
export class XpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getBalance(userId: number) {
    const progress = await this.getUserProgress(userId, { awardDailyLogin: true });
    return progress.xpBalance;
  }

  async getUserProgress(userId: number, options: GetUserProgressOptions = {}) {
    if (options.awardDailyLogin) {
      await this.awardDailyLogin(userId);
    }

    const user = await this.getUserRewardState(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return this.buildProgressSnapshot(user);
  }

  async spend(userId: number, amount: number, reason: string, metadata?: Prisma.InputJsonObject, eventKey?: string) {
    if (amount <= 0) return null;

    const existing = eventKey
      ? await this.prisma.xpTransaction.findUnique({ where: { eventKey } })
      : null;
    if (existing) return existing;

    const reasonLabel = this.formatReason(reason);

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { xpBalance: true },
        });
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

        return tx.xpTransaction.create({
          data: {
            userId,
            type: 'SPEND',
            reason,
            amount,
            balanceAfter: nextBalance,
            eventKey,
            metadata: metadata ?? undefined,
          },
        });
      });

      await this.notifications.createNotification({
        userId,
        type: 'XP',
        title: `-${amount} XP`,
        body: `XP spent: ${reasonLabel}`,
        data: { reason, amount, balance: record.balanceAfter },
      });

      return record;
    } catch (error) {
      if (eventKey && this.isUniqueEventKeyViolation(error)) {
        return this.prisma.xpTransaction.findUnique({ where: { eventKey } });
      }
      throw error;
    }
  }

  async awardSignup(userId: number) {
    return this.awardXp(userId, XP_VALUES[XP_REASONS.SIGNUP], XP_REASONS.SIGNUP, {
      eventKey: `xp:signup:user:${userId}`,
      countsTowardDailyCap: false,
    });
  }

  async awardCompleteProfile(userId: number) {
    const eventKeyBase = `user:${userId}:complete_profile`;
    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.COMPLETE_PROFILE], XP_REASONS.COMPLETE_PROFILE, {
        eventKey: `xp:${eventKeyBase}`,
        countsTowardDailyCap: false,
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.COMPLETE_PROFILE], RS_REASONS.COMPLETE_PROFILE, {
        eventKey: `rs:${eventKeyBase}`,
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async checkAndAwardProfileCompletion(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatarUrl: true, bio: true },
    });
    if (!user || !this.isProfileComplete(user)) {
      return null;
    }
    return this.awardCompleteProfile(userId);
  }

  async awardFundWallet(userId: number, amount?: number, txHash?: string) {
    const eventBase = txHash
      ? `wallet_credit:${txHash}`
      : `wallet_credit:user:${userId}:amount:${amount ?? 'unknown'}:${this.toDayKey(new Date())}`;

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.FUND_WALLET], XP_REASONS.FUND_WALLET, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: true,
        metadata: amount != null ? { amount, txHash: txHash ?? null } : { txHash: txHash ?? null },
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.FUND_WALLET], RS_REASONS.FUND_WALLET, {
        eventKey: `rs:${eventBase}`,
        metadata: amount != null ? { amount, txHash: txHash ?? null } : { txHash: txHash ?? null },
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async awardShareAd(userId: number, adId: string) {
    const now = new Date();
    const dayStart = this.startOfDay(now);
    const dayEnd = this.endOfDay(now);

    const todayShareCount = await this.prisma.xpTransaction.count({
      where: {
        userId,
        type: 'EARN',
        reason: XP_REASONS.SHARE_AD,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    });

    if (todayShareCount >= 3) {
      return null;
    }

    const eventBase = `share_ad:user:${userId}:ad:${adId}:day:${this.toDayKey(now)}`;
    const metadata = { adId, day: this.toDayKey(now) };

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.SHARE_AD], XP_REASONS.SHARE_AD, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: true,
        metadata,
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.SHARE_AD], RS_REASONS.SHARE_AD, {
        eventKey: `rs:${eventBase}`,
        metadata,
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async awardApprovedListing(userId: number, listingId: string) {
    const eventBase = `listing_approved:${listingId}`;
    const metadata = { listingId };

    const [xp, rank] = await Promise.all([
      this.awardXp(
        userId,
        XP_VALUES[XP_REASONS.LISTING_APPROVED_PUBLISHED],
        XP_REASONS.LISTING_APPROVED_PUBLISHED,
        {
          eventKey: `xp:${eventBase}`,
          countsTowardDailyCap: false,
          metadata,
        },
      ),
      this.awardRankScore(
        userId,
        RANK_SCORE_VALUES[RS_REASONS.LISTING_APPROVED_PUBLISHED],
        RS_REASONS.LISTING_APPROVED_PUBLISHED,
        {
          eventKey: `rs:${eventBase}`,
          metadata,
          notifyTierChange: true,
        },
      ),
    ]);

    return { xp, rank };
  }

  async awardApprovedAd(userId: number, adId: string) {
    const eventBase = `ad_approved:${adId}`;
    const metadata = { adId };

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.AD_APPROVED_PUBLISHED], XP_REASONS.AD_APPROVED_PUBLISHED, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: false,
        metadata,
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.AD_APPROVED_PUBLISHED], RS_REASONS.AD_APPROVED_PUBLISHED, {
        eventKey: `rs:${eventBase}`,
        metadata,
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async awardEscrowCompletion(userId: number, escrowId: string, role: 'poster' | 'applicant') {
    const eventBase = `escrow_completed:${escrowId}:${role}`;
    const metadata = { escrowId, role };

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.ESCROW_COMPLETED], XP_REASONS.ESCROW_COMPLETED, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: false,
        metadata,
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.ESCROW_COMPLETED], RS_REASONS.ESCROW_COMPLETED, {
        eventKey: `rs:${eventBase}`,
        metadata,
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async awardLeaveReview(userId: number, reviewId: string) {
    const eventBase = `leave_review:${reviewId}:user:${userId}`;
    const metadata = { reviewId };

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.LEAVE_REVIEW], XP_REASONS.LEAVE_REVIEW, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: true,
        metadata,
      }),
      this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.LEAVE_REVIEW], RS_REASONS.LEAVE_REVIEW, {
        eventKey: `rs:${eventBase}`,
        metadata,
        notifyTierChange: true,
      }),
    ]);

    return { xp, rank };
  }

  async awardReceivePositiveReview(userId: number, reviewId: string) {
    const eventBase = `receive_positive_review:${reviewId}:user:${userId}`;
    const metadata = { reviewId };

    const [xp, rank] = await Promise.all([
      this.awardXp(userId, XP_VALUES[XP_REASONS.RECEIVE_POSITIVE_REVIEW], XP_REASONS.RECEIVE_POSITIVE_REVIEW, {
        eventKey: `xp:${eventBase}`,
        countsTowardDailyCap: true,
        metadata,
      }),
      this.awardRankScore(
        userId,
        RANK_SCORE_VALUES[RS_REASONS.RECEIVE_POSITIVE_REVIEW],
        RS_REASONS.RECEIVE_POSITIVE_REVIEW,
        {
          eventKey: `rs:${eventBase}`,
          metadata,
          notifyTierChange: true,
        },
      ),
    ]);

    return { xp, rank };
  }

  async awardDailyLogin(userId: number) {
    const user = await this.getUserRewardState(userId);
    if (!user) throw new BadRequestException('User not found');

    const now = new Date();
    const today = this.startOfDay(now);
    const lastLoginDay = user.lastLoginDate ? this.startOfDay(user.lastLoginDate) : null;

    if (lastLoginDay && lastLoginDay.getTime() === today.getTime()) {
      return null;
    }

    const nextStreakDays = this.calculateNextStreakDays(lastLoginDay, today, user.currentStreakDays || 0);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        currentStreakDays: nextStreakDays,
        lastLoginDate: now,
        lastDailyXpAt: now,
      },
    });

    const dayKey = this.toDayKey(now);

    const rewards: unknown[] = [];
    rewards.push(
      await this.awardXp(userId, XP_VALUES[XP_REASONS.DAILY_LOGIN], XP_REASONS.DAILY_LOGIN, {
        eventKey: `xp:daily_login:user:${userId}:day:${dayKey}`,
        countsTowardDailyCap: true,
        metadata: { streakDays: nextStreakDays, day: dayKey },
      }),
    );

    rewards.push(
      await this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.DAILY_LOGIN], RS_REASONS.DAILY_LOGIN, {
        eventKey: `rs:daily_login:user:${userId}:day:${dayKey}`,
        metadata: { streakDays: nextStreakDays, day: dayKey },
        notifyTierChange: true,
      }),
    );

    if (nextStreakDays === 7) {
      rewards.push(
        await this.awardXp(userId, XP_VALUES[XP_REASONS.LOGIN_STREAK_7], XP_REASONS.LOGIN_STREAK_7, {
          eventKey: `xp:login_streak_7:user:${userId}:day:${dayKey}`,
          countsTowardDailyCap: false,
          metadata: { streakDays: nextStreakDays, day: dayKey },
        }),
      );

      rewards.push(
        await this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.LOGIN_STREAK_7], RS_REASONS.LOGIN_STREAK_7, {
          eventKey: `rs:login_streak_7:user:${userId}:day:${dayKey}`,
          metadata: { streakDays: nextStreakDays, day: dayKey },
          notifyTierChange: true,
        }),
      );
    }

    if (nextStreakDays === 30) {
      rewards.push(
        await this.awardXp(userId, XP_VALUES[XP_REASONS.LOGIN_STREAK_30], XP_REASONS.LOGIN_STREAK_30, {
          eventKey: `xp:login_streak_30:user:${userId}:day:${dayKey}`,
          countsTowardDailyCap: false,
          metadata: { streakDays: nextStreakDays, day: dayKey },
        }),
      );

      rewards.push(
        await this.awardRankScore(userId, RANK_SCORE_VALUES[RS_REASONS.LOGIN_STREAK_30], RS_REASONS.LOGIN_STREAK_30, {
          eventKey: `rs:login_streak_30:user:${userId}:day:${dayKey}`,
          metadata: { streakDays: nextStreakDays, day: dayKey },
          notifyTierChange: true,
        }),
      );
    }

    return rewards;
  }

  async processAccountAgeMilestones() {
    const users = await this.prisma.user.findMany({
      select: { id: true, createdAt: true },
    });

    let awarded = 0;
    for (const user of users) {
      const daysOnPlatform = this.calculateDaysOnPlatform(user.createdAt);
      for (const milestone of ACCOUNT_AGE_MILESTONES) {
        if (daysOnPlatform < milestone.days) {
          continue;
        }

        const result = await this.awardRankScore(user.id, milestone.amount, milestone.reason, {
          eventKey: `rs:account_age:${milestone.days}:user:${user.id}`,
          metadata: { milestoneDays: milestone.days },
          notifyTierChange: true,
        });

        if (result) {
          awarded += 1;
        }
      }
    }

    return awarded;
  }

  async awardLegacyMigrationAdjustment(
    userId: number,
    xpAmount: number,
    rankAmount: number,
    eventSuffix: string,
    metadata?: Prisma.InputJsonObject,
  ) {
    const xp = xpAmount > 0
      ? await this.awardXp(userId, xpAmount, XP_REASONS.LEGACY_MIGRATION_ADJUSTMENT, {
          eventKey: `xp:legacy_adjustment:${eventSuffix}`,
          countsTowardDailyCap: false,
          notify: false,
          metadata,
        })
      : null;

    const rank = rankAmount > 0
      ? await this.awardRankScore(userId, rankAmount, RS_REASONS.LEGACY_MIGRATION_ADJUSTMENT, {
          eventKey: `rs:legacy_adjustment:${eventSuffix}`,
          metadata,
          notifyTierChange: false,
        })
      : null;

    return { xp, rank };
  }

  private async awardXp(userId: number, amount: number, reason: string, options: AwardXpOptions = {}) {
    if (amount <= 0) return null;

    const existing = options.eventKey
      ? await this.prisma.xpTransaction.findUnique({ where: { eventKey: options.eventKey } })
      : null;
    if (existing) return existing;

    const countsTowardDailyCap = options.countsTowardDailyCap ?? XP_CAPPED_REASONS.has(reason);
    const reasonLabel = this.formatReason(reason);

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { xpBalance: true },
        });
        if (!user) throw new BadRequestException('User not found');

        const amountToAward = countsTowardDailyCap
          ? await this.applyDailyCap(tx, userId, amount)
          : amount;

        if (amountToAward <= 0) {
          return null;
        }

        const nextBalance = (user.xpBalance || 0) + amountToAward;
        await tx.user.update({
          where: { id: userId },
          data: { xpBalance: nextBalance },
        });

        return tx.xpTransaction.create({
          data: {
            userId,
            type: 'EARN',
            reason,
            amount: amountToAward,
            balanceAfter: nextBalance,
            eventKey: options.eventKey,
            metadata: {
              ...(options.metadata ?? {}),
              originalAmount: amount,
              countsTowardDailyCap,
            },
          },
        });
      });

      if (!record) {
        return null;
      }

      if (options.notify !== false) {
        await this.notifications.createNotification({
          userId,
          type: 'XP',
          title: `+${record.amount} XP`,
          body: `XP earned: ${reasonLabel}`,
          data: { reason, amount: record.amount, balance: record.balanceAfter },
        });
      }

      return record;
    } catch (error) {
      if (options.eventKey && this.isUniqueEventKeyViolation(error)) {
        return this.prisma.xpTransaction.findUnique({ where: { eventKey: options.eventKey } });
      }
      throw error;
    }
  }

  private async awardRankScore(userId: number, amount: number, reason: string, options: AwardRankOptions = {}) {
    if (amount <= 0) return null;

    const existing = options.eventKey
      ? await this.prisma.rankScoreTransaction.findUnique({ where: { eventKey: options.eventKey } })
      : null;
    if (existing) return existing;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            createdAt: true,
            rankScore: true,
            rankTier: true,
          },
        });
        if (!user) throw new BadRequestException('User not found');

        const nextRankScore = (user.rankScore || 0) + amount;
        const daysOnPlatform = this.calculateDaysOnPlatform(user.createdAt);
        const nextTier = getRankTierForScore(nextRankScore, daysOnPlatform);

        await tx.user.update({
          where: { id: userId },
          data: {
            rankScore: nextRankScore,
            rankTier: nextTier.tier,
          },
        });

        const record = await tx.rankScoreTransaction.create({
          data: {
            userId,
            reason,
            amount,
            rankScoreAfter: nextRankScore,
            eventKey: options.eventKey,
            metadata: options.metadata ?? undefined,
          },
        });

        return {
          record,
          previousTier: user.rankTier || 1,
          nextTier: nextTier.tier,
          nextTierLabel: nextTier.badgeName,
        };
      });

      if (options.notifyTierChange !== false && result.nextTier > result.previousTier) {
        await this.notifications.createNotification({
          userId,
          type: 'SYSTEM',
          title: 'Rank up',
          body: `You reached ${result.nextTierLabel}`,
          data: { rankTier: result.nextTier, previousTier: result.previousTier },
        });
      }

      return result.record;
    } catch (error) {
      if (options.eventKey && this.isUniqueEventKeyViolation(error)) {
        return this.prisma.rankScoreTransaction.findUnique({ where: { eventKey: options.eventKey } });
      }
      throw error;
    }
  }

  private async applyDailyCap(tx: TxClient, userId: number, requestedAmount: number) {
    const todayStart = this.startOfDay(new Date());
    const todayEnd = this.endOfDay(new Date());

    const aggregate = await tx.xpTransaction.aggregate({
      where: {
        userId,
        type: 'EARN',
        reason: { in: Array.from(XP_CAPPED_REASONS) },
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      _sum: { amount: true },
    });

    const earnedToday = aggregate._sum.amount ?? 0;
    const remaining = Math.max(XP_DAILY_CAP - earnedToday, 0);

    return Math.min(requestedAmount, remaining);
  }

  private async getUserRewardState(userId: number): Promise<UserRewardState | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        xpBalance: true,
        rankScore: true,
        rankTier: true,
        currentStreakDays: true,
        lastLoginDate: true,
        lastDailyXpAt: true,
      },
    });
  }

  private buildProgressSnapshot(user: UserRewardState): UserRewardProgress {
    const daysOnPlatform = this.calculateDaysOnPlatform(user.createdAt);
    const currentTier = getRankTierForScore(user.rankScore || 0, daysOnPlatform);
    const nextTier = RANK_TIERS.find((tier) => tier.tier === currentTier.tier + 1) ?? null;

    const scoreProgressPercent = nextTier
      ? this.calculateRelativeProgress(
          user.rankScore || 0,
          currentTier.minRankScore,
          nextTier.minRankScore,
        )
      : 100;

    const dayProgressPercent = nextTier
      ? this.calculateRelativeProgress(
          daysOnPlatform,
          currentTier.minDaysOnPlatform,
          nextTier.minDaysOnPlatform,
        )
      : 100;

    return {
      xpBalance: user.xpBalance ?? 0,
      rankScore: user.rankScore ?? 0,
      rankTier: currentTier.tier,
      rankLevel: currentTier.level,
      rankLabel: currentTier.badgeName,
      rankEmoji: currentTier.emoji,
      daysOnPlatform,
      currentStreakDays: user.currentStreakDays ?? 0,
      nextRankTier: nextTier?.tier ?? null,
      nextRankLevel: nextTier?.level ?? null,
      nextRankLabel: nextTier?.badgeName ?? null,
      progressPercent: nextTier ? Math.min(scoreProgressPercent, dayProgressPercent) : 100,
      scoreProgressPercent,
      dayProgressPercent,
      rankScoreToNext: nextTier ? Math.max(nextTier.minRankScore - (user.rankScore ?? 0), 0) : 0,
      daysToNext: nextTier ? Math.max(nextTier.minDaysOnPlatform - daysOnPlatform, 0) : 0,
    };
  }

  private calculateNextStreakDays(lastLoginDay: Date | null, today: Date, currentStreakDays: number) {
    if (!lastLoginDay) {
      return 1;
    }

    const diffInDays = Math.round((today.getTime() - lastLoginDay.getTime()) / 86400000);
    if (diffInDays === 1) {
      return currentStreakDays + 1;
    }

    if (diffInDays === 0) {
      return currentStreakDays;
    }

    return 1;
  }

  private calculateDaysOnPlatform(createdAt: Date) {
    const created = this.startOfDay(createdAt);
    const today = this.startOfDay(new Date());
    return Math.max(Math.floor((today.getTime() - created.getTime()) / 86400000), 0);
  }

  private calculateRelativeProgress(value: number, min: number, max: number) {
    if (max <= min) {
      return 100;
    }
    const percent = ((value - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, percent));
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private endOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  private toDayKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private isProfileComplete(user: { name?: string | null; avatarUrl?: string | null; bio?: string | null }) {
    return !!(user.name?.trim() && user.avatarUrl?.trim() && user.bio?.trim());
  }

  private isUniqueEventKeyViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private formatReason(reason: string) {
    const labels: Record<string, string> = {
      [XP_REASONS.SIGNUP]: 'Signup',
      [XP_REASONS.COMPLETE_PROFILE]: 'Complete profile',
      [XP_REASONS.DAILY_LOGIN]: 'Daily login',
      [XP_REASONS.LOGIN_STREAK_7]: '7-day login streak bonus',
      [XP_REASONS.LOGIN_STREAK_30]: '30-day login streak bonus',
      [XP_REASONS.FUND_WALLET]: 'Fund wallet',
      [XP_REASONS.LISTING_APPROVED_PUBLISHED]: 'Listing approved and published',
      [XP_REASONS.AD_APPROVED_PUBLISHED]: 'Ad approved and published',
      [XP_REASONS.SHARE_AD]: 'Share ad',
      [XP_REASONS.LEAVE_REVIEW]: 'Leave a review',
      [XP_REASONS.RECEIVE_POSITIVE_REVIEW]: 'Receive a positive review',
      [XP_REASONS.ESCROW_COMPLETED]: 'Successful escrow completion',
      [XP_REASONS.START_CONVERSATION]: 'Start a conversation',
      [XP_REASONS.LEGACY_MIGRATION_ADJUSTMENT]: 'Migration adjustment',
      [RS_REASONS.ACCOUNT_AGE_30_DAYS]: '30-day account age milestone',
      [RS_REASONS.ACCOUNT_AGE_90_DAYS]: '90-day account age milestone',
      [RS_REASONS.ACCOUNT_AGE_180_DAYS]: '180-day account age milestone',
      [RS_REASONS.ACCOUNT_AGE_365_DAYS]: '365-day account age milestone',
    };

    if (labels[reason]) {
      return labels[reason];
    }

    const withSpaces = reason.replace(/_/g, ' ');
    return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
  }
}
