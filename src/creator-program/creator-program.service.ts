import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreatorEarningStatus, CreatorEarningType, CreatorPayoutStatus, CreatorReferralStatus, CreatorTier, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type CreatorFraudStatus = 'CLEAR' | 'REVIEW' | 'HOLD';

const MIN_PAYOUT_USD = 10;

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeCode(code: string) {
  return code.trim().toLowerCase();
}

@Injectable()
export class CreatorProgramService {
  private readonly logger = new Logger(CreatorProgramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private get frontendBaseUrl() {
    return (
      this.configService.get<string>('APP_FRONTEND_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_FRONTEND_URL') ||
      'https://app.ctomarketplace.com'
    ).replace(/\/$/, '');
  }

  private getReferralLink(code: string) {
    return `${this.frontendBaseUrl}/?ref=${code}`;
  }

  private getCutPercent(activeReferralsCount: number) {
    if (activeReferralsCount >= 31) return 20;
    if (activeReferralsCount >= 11) return 15;
    if (activeReferralsCount >= 1) return 10;
    return 0;
  }

  private getTier(activeReferralsCount: number): CreatorTier {
    if (activeReferralsCount >= 11 && activeReferralsCount <= 30) return 'BUILDER';
    if (activeReferralsCount >= 31) return 'PARTNER';
    return 'STARTER';
  }

  private nextTierTarget(activeReferralsCount: number) {
    if (activeReferralsCount < 1) return 1;
    if (activeReferralsCount < 11) return 11;
    if (activeReferralsCount < 31) return 31;
    return null;
  }

  private async generateUniqueReferralCode(tx: Prisma.TransactionClient, userId: number) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = `cto-${userId}-${randomBytes(3).toString('hex')}`.toLowerCase();
      const existing = await tx.creatorProgramAccount.findUnique({ where: { referralCode: code } });
      if (!existing) return code;
    }
    return `cto-${userId}-${Date.now().toString(36)}`.toLowerCase();
  }

  private async ensureCreatorAccountTx(tx: Prisma.TransactionClient, userId: number) {
    const existing = await tx.creatorProgramAccount.findUnique({
      where: { userId },
    });
    if (existing) {
      const currentReferralLink = this.getReferralLink(existing.referralCode);
      if (existing.referralLink !== currentReferralLink) {
        return tx.creatorProgramAccount.update({
          where: { userId },
          data: { referralLink: currentReferralLink },
        });
      }
      return existing;
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const referralCode = await this.generateUniqueReferralCode(tx, userId);
    const referralLink = this.getReferralLink(referralCode);

    try {
      return await tx.creatorProgramAccount.create({
        data: {
          userId,
          referralCode,
          referralLink,
          tier: 'STARTER',
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raceWinner = await tx.creatorProgramAccount.findUnique({
          where: { userId },
        });
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw error;
    }
  }

  private async ensureCreatorAccount(userId: number) {
    return this.prisma.$transaction(async (tx) => this.ensureCreatorAccountTx(tx, userId));
  }

  private async getCreatorAccountByUserId(userId: number) {
    return this.prisma.creatorProgramAccount.findUnique({
      where: { userId },
    });
  }

  async getReferralLinkForUser(userId: number) {
    const account = await this.ensureCreatorAccount(userId);
    return {
      referralCode: account.referralCode,
      referralLink: this.getReferralLink(account.referralCode),
    };
  }

  async getDashboard(userId: number, recentLimit = 20) {
    const account = await this.ensureCreatorAccount(userId);
    const now = new Date();
    const monthStart = startOfMonth(now);
    const dayStart = startOfDay(now);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [referrals, earnings, payouts] = await Promise.all([
      this.prisma.creatorReferral.findMany({
        where: { creatorUserId: userId },
        orderBy: { signedUpAt: 'desc' },
        take: recentLimit,
        include: {
          referredUser: {
            select: { id: true, email: true, name: true, createdAt: true },
          },
        },
      }),
      this.prisma.creatorEarning.findMany({
        where: { creatorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: recentLimit,
      }),
      this.prisma.creatorPayout.findMany({
        where: { creatorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: recentLimit,
      }),
    ]);

    const recentThirtyDayEarnings = await this.prisma.creatorEarning.findMany({
      where: {
        creatorUserId: userId,
        createdAt: { gte: thirtyDaysAgo },
        status: { not: 'REVERSED' },
      },
      orderBy: { createdAt: 'asc' },
    });

    const monthEarnings = recentThirtyDayEarnings.filter((earning) => earning.createdAt >= monthStart);
    const dailyMap = new Map<string, { date: string; amount: number }>();
    const breakdownMap = new Map<string, { type: CreatorEarningType; amount: number }>();
    let monthTotal = 0;

    for (const earning of recentThirtyDayEarnings) {
      const dayKey = toDayKey(earning.createdAt);
      const currentDay = dailyMap.get(dayKey) ?? { date: dayKey, amount: 0 };
      currentDay.amount += earning.amountEarned;
      dailyMap.set(dayKey, currentDay);

      const currentBreakdown = breakdownMap.get(earning.sourceType) ?? { type: earning.sourceType, amount: 0 };
      currentBreakdown.amount += earning.amountEarned;
      breakdownMap.set(earning.sourceType, currentBreakdown);
    }

    for (const earning of monthEarnings) {
      monthTotal += earning.amountEarned;
    }

    const monthlyBreakdown = Array.from(breakdownMap.values());
    const dailyEarnings = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const nextTierTarget = this.nextTierTarget(account.activeReferralsCount);

    return {
      success: true,
      account: {
        id: account.id,
        userId: account.userId,
        referralCode: account.referralCode,
        referralLink: this.getReferralLink(account.referralCode),
        tier: account.tier,
        activeReferralsCount: account.activeReferralsCount,
        totalReferralsCount: account.totalReferralsCount,
        totalEarned: account.totalEarned,
        pendingBalance: account.pendingBalance,
        reservedBalance: account.reservedBalance,
        paidBalance: account.paidBalance,
        heldBalance: account.heldBalance,
        payoutWalletAddress: account.payoutWalletAddress,
        fraudStatus: account.fraudStatus,
        fraudReason: account.fraudReason,
        lastReviewedAt: account.lastReviewedAt,
      },
      stats: {
        totalReferrals: account.totalReferralsCount,
        activeReferrals: account.activeReferralsCount,
        tier: account.tier,
        referralsNeededForNextTier: nextTierTarget == null ? 0 : Math.max(nextTierTarget - account.activeReferralsCount, 0),
        thisMonthEarnings: monthTotal,
        pendingPayoutBalance: account.pendingBalance,
        reservedPayoutBalance: account.reservedBalance,
        allTimeTotalEarned: account.totalEarned,
        creatorCutPercent: this.getCutPercent(account.activeReferralsCount),
        nextTierTarget,
      },
      earningsBreakdown: monthlyBreakdown,
      dailyEarnings,
      referrals: referrals.map((referral) => ({
        id: referral.id,
        referredUserId: referral.referredUserId,
        referredUser: {
          id: referral.referredUser.id,
          email: referral.referredUser.email,
          name: referral.referredUser.name,
        },
        status: referral.status,
        isActive: referral.isActive,
        isFraudFlagged: referral.isFraudFlagged,
        signedUpAt: referral.signedUpAt,
        activatedAt: referral.activatedAt,
        totalEarned: referral.totalEarned,
        firstQualifyingActionType: referral.firstQualifyingActionType,
      })),
      earnings: earnings.map((earning) => ({
        id: earning.id,
        sourceType: earning.sourceType,
        sourceId: earning.sourceId,
        amountGross: earning.amountGross,
        platformFeeAmount: earning.platformFeeAmount,
        creatorCutPercent: earning.creatorCutPercent,
        amountEarned: earning.amountEarned,
        status: earning.status,
        createdAt: earning.createdAt,
        paymentId: earning.paymentId,
        escrowId: earning.escrowId,
      })),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        status: payout.status,
        amountRequested: payout.amountRequested,
        amountApproved: payout.amountApproved,
        walletAddress: payout.walletAddress,
        txHash: payout.txHash,
        requestNote: payout.requestNote,
        createdAt: payout.createdAt,
        processedAt: payout.processedAt,
        reviewedAt: payout.reviewedAt,
        failureReason: payout.failureReason,
      })),
    };
  }

  async getReferrals(userId: number, limit = 50) {
    await this.ensureCreatorAccount(userId);
    const referrals = await this.prisma.creatorReferral.findMany({
      where: { creatorUserId: userId },
      orderBy: { signedUpAt: 'desc' },
      take: limit,
      include: {
        referredUser: {
          select: { id: true, email: true, name: true, createdAt: true },
        },
      },
    });
    return {
      success: true,
      referrals,
    };
  }

  async getEarnings(userId: number, limit = 50) {
    await this.ensureCreatorAccount(userId);
    const earnings = await this.prisma.creatorEarning.findMany({
      where: { creatorUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { success: true, earnings };
  }

  async getPayouts(userId: number, limit = 20) {
    await this.ensureCreatorAccount(userId);
    const payouts = await this.prisma.creatorPayout.findMany({
      where: { creatorUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { success: true, payouts };
  }

  async captureReferral(params: {
    referredUserId: number;
    referralCode?: string | null;
    referralSource?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    walletAddresses?: string[];
    metadata?: Prisma.InputJsonObject;
  }) {
    const referralCode = params.referralCode?.trim();
    if (!referralCode) return null;

    const normalizedCode = normalizeCode(referralCode);
    const existing = await this.prisma.creatorReferral.findUnique({
      where: { referredUserId: params.referredUserId },
    });
    if (existing) return existing;

    const creatorAccount = await this.prisma.creatorProgramAccount.findUnique({
      where: { referralCode: normalizedCode },
    });
    if (!creatorAccount) {
      return null;
    }

    if (creatorAccount.userId === params.referredUserId) {
      return this.prisma.creatorReferral.create({
        data: {
          creatorUserId: creatorAccount.userId,
          referredUserId: params.referredUserId,
          referralCode: normalizedCode,
          referralSource: params.referralSource ?? 'SELF',
          ipAddress: params.ipAddress ?? undefined,
          userAgent: params.userAgent ?? undefined,
          status: 'FRAUD_HOLD',
          isActive: false,
          isFraudFlagged: true,
          fraudReason: 'Self-referral blocked',
          metadata: params.metadata,
        },
      });
    }

    const [creatorWallets, referredWallets] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { userId: creatorAccount.userId },
        select: { address: true },
      }),
      this.prisma.wallet.findMany({
        where: { userId: params.referredUserId },
        select: { address: true },
      }),
    ]);

    const creatorAddresses = new Set(creatorWallets.map((wallet) => wallet.address?.toLowerCase()).filter(Boolean) as string[]);
    const referredAddresses = new Set(
      (params.walletAddresses?.length ? params.walletAddresses : referredWallets.map((wallet) => wallet.address))
        .map((address) => address?.toLowerCase())
        .filter(Boolean) as string[],
    );

    const overlappingWallet = Array.from(referredAddresses).find((address) => creatorAddresses.has(address));
    const duplicateIp = params.ipAddress
      ? await this.prisma.creatorReferral.findFirst({
          where: {
            creatorUserId: creatorAccount.userId,
            ipAddress: params.ipAddress,
          },
        })
      : null;

    const isFraud = Boolean(overlappingWallet || duplicateIp);
    const fraudReason = overlappingWallet
      ? 'Self-referral or shared wallet detected'
      : duplicateIp
        ? 'Duplicate IP detected'
        : null;

    if (isFraud) {
      await this.prisma.creatorProgramAccount.update({
        where: { id: creatorAccount.id },
        data: {
          fraudStatus: 'REVIEW',
          fraudReason,
        },
      });
    }

    const referral = await this.prisma.creatorReferral.create({
      data: {
        creatorUserId: creatorAccount.userId,
        referredUserId: params.referredUserId,
        referralCode: normalizedCode,
        referralSource: params.referralSource ?? 'DIRECT',
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        status: isFraud ? 'FRAUD_HOLD' : 'SIGNED_UP',
        isActive: false,
        isFraudFlagged: isFraud,
        fraudReason: fraudReason ?? undefined,
        metadata: params.metadata,
      },
    });

    if (!isFraud) {
      await this.prisma.creatorProgramAccount.update({
        where: { id: creatorAccount.id },
        data: {
          totalReferralsCount: { increment: 1 },
        },
      });
    }

    return referral;
  }

  async markReferralActive(params: {
    referredUserId: number;
    actionType: string;
    actionId: string;
    metadata?: Prisma.InputJsonObject;
  }) {
    const referral = await this.prisma.creatorReferral.findUnique({
      where: { referredUserId: params.referredUserId },
      include: { creatorUser: true },
    });
    if (!referral || referral.isFraudFlagged || referral.isActive) {
      return referral;
    }

    const updatedReferral = await this.prisma.$transaction(async (tx) => {
      const activeReferral = await tx.creatorReferral.update({
        where: { id: referral.id },
        data: {
          isActive: true,
          status: 'ACTIVE',
          activatedAt: new Date(),
          firstQualifyingActionType: params.actionType,
          firstQualifyingActionId: params.actionId,
        },
      });

      const account = await this.ensureCreatorAccountTx(tx, referral.creatorUserId!);
      const nextActiveCount = account.activeReferralsCount + 1;
      const tier = this.getTier(nextActiveCount);

      await tx.creatorProgramAccount.update({
        where: { id: account.id },
        data: {
          activeReferralsCount: { increment: 1 },
          tier,
        },
      });

      return activeReferral;
    });

    return updatedReferral;
  }

  private async recordEarning(params: {
    creatorUserId: number;
    referredUserId: number;
    sourceType: CreatorEarningType;
    sourceId: string;
    amountGross: number;
    platformFeeAmount: number;
    eventKey: string;
    paymentId?: string | null;
    escrowId?: string | null;
    metadata?: Prisma.InputJsonObject;
    forceHold?: boolean;
  }) {
    if (!Number.isFinite(params.amountGross) || params.amountGross <= 0) {
      return null;
    }

    const existing = await this.prisma.creatorEarning.findUnique({
      where: { eventKey: params.eventKey },
    });
    if (existing) return existing;

    const referral = await this.prisma.creatorReferral.findUnique({
      where: { referredUserId: params.referredUserId },
    });
    if (!referral || referral.isFraudFlagged) {
      return null;
    }

    const account = await this.ensureCreatorAccount(params.creatorUserId);
    const creatorCutPercent = this.getCutPercent(account.activeReferralsCount);
    if (creatorCutPercent <= 0) {
      return null;
    }

    const amountEarned = Number(((params.platformFeeAmount * creatorCutPercent) / 100).toFixed(6));
    const status: CreatorEarningStatus = params.forceHold || account.fraudStatus !== 'CLEAR' ? 'HELD' : 'PENDING';

    const earning = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creatorEarning.create({
        data: {
          creatorAccountId: account.id,
          creatorUserId: params.creatorUserId,
          referredUserId: params.referredUserId,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          paymentId: params.paymentId ?? undefined,
          escrowId: params.escrowId ?? undefined,
          amountGross: params.amountGross,
          platformFeeAmount: params.platformFeeAmount,
          creatorCutPercent,
          amountEarned,
          status,
          eventKey: params.eventKey,
          metadata: params.metadata,
        },
      });

      await tx.creatorProgramAccount.update({
        where: { id: account.id },
        data: {
          totalEarned: { increment: amountEarned },
          ...(status === 'HELD'
            ? { heldBalance: { increment: amountEarned } }
            : { pendingBalance: { increment: amountEarned } }),
        },
      });

      await tx.creatorReferral.update({
        where: { referredUserId: params.referredUserId },
        data: {
          totalEarned: { increment: amountEarned },
        },
      });

      return created;
    });

    return earning;
  }

  async recordPaymentRevenue(params: {
    paymentId: string;
    sourceType: CreatorEarningType;
    payerUserId: number;
    amountGross: number;
    platformFeeAmount: number;
    metadata?: Prisma.InputJsonObject;
  }) {
    const referral = await this.prisma.creatorReferral.findUnique({
      where: { referredUserId: params.payerUserId },
    });
    if (!referral) return null;

    await this.markReferralActive({
      referredUserId: params.payerUserId,
      actionType: params.sourceType,
      actionId: params.paymentId,
      metadata: params.metadata,
    });

    return this.recordEarning({
      creatorUserId: referral.creatorUserId!,
      referredUserId: params.payerUserId,
      sourceType: params.sourceType,
      sourceId: params.paymentId,
      amountGross: params.amountGross,
      platformFeeAmount: params.platformFeeAmount,
      eventKey: `creator:${params.sourceType.toLowerCase()}:payment:${params.paymentId}`,
      paymentId: params.paymentId,
      metadata: params.metadata,
    });
  }

  async recordEscrowRevenue(params: {
    escrowId: string;
    posterUserId: number;
    applicantUserId: number;
    amountGross: number;
    metadata?: Prisma.InputJsonObject;
  }) {
    const platformFeeAmount = Number((params.amountGross * 0.06).toFixed(6));
    if (platformFeeAmount <= 0) return [];

    const eligibleParticipants = await this.prisma.creatorReferral.findMany({
      where: {
        referredUserId: { in: [params.posterUserId, params.applicantUserId] },
        isFraudFlagged: false,
      },
    });

    if (eligibleParticipants.length === 0) {
      return [];
    }

    const share = Number((platformFeeAmount / eligibleParticipants.length).toFixed(6));
    const results = [];

    for (const participant of eligibleParticipants) {
      await this.markReferralActive({
        referredUserId: participant.referredUserId,
        actionType: 'ESCROW_FEE',
        actionId: params.escrowId,
        metadata: params.metadata,
      });

      const earning = await this.recordEarning({
        creatorUserId: participant.creatorUserId!,
        referredUserId: participant.referredUserId,
        sourceType: 'ESCROW_FEE',
        sourceId: `${params.escrowId}:${participant.referredUserId}`,
        amountGross: params.amountGross,
        platformFeeAmount: share,
        eventKey: `creator:escrow:${params.escrowId}:${participant.referredUserId}`,
        escrowId: params.escrowId,
        metadata: params.metadata,
      });
      if (earning) {
        results.push(earning);
      }
    }

    return results;
  }

  async requestPayout(userId: number, payload: { walletAddress?: string; amount?: number; note?: string }) {
    const account = await this.ensureCreatorAccount(userId);
    if (account.fraudStatus !== 'CLEAR') {
      throw new ForbiddenException('Creator account is on hold pending review');
    }

    const amount = payload.amount ?? account.pendingBalance;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payout amount must be greater than zero');
    }
    if (amount < MIN_PAYOUT_USD) {
      throw new BadRequestException(`Minimum payout is $${MIN_PAYOUT_USD}`);
    }
    if (amount > account.pendingBalance) {
      throw new BadRequestException('Insufficient pending balance');
    }

    const walletAddress = (payload.walletAddress || account.payoutWalletAddress || '').trim();
    if (!walletAddress) {
      throw new BadRequestException('Wallet address is required for payout requests');
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      const payout = await tx.creatorPayout.create({
        data: {
          creatorAccountId: account.id,
          creatorUserId: userId,
          walletAddress,
          amountRequested: amount,
          status: 'REQUESTED',
          requestNote: payload.note?.trim() || null,
        },
      });

      await tx.creatorProgramAccount.update({
        where: { id: account.id },
        data: {
          pendingBalance: { decrement: amount },
          reservedBalance: { increment: amount },
          payoutWalletAddress: walletAddress,
        },
      });

      return payout;
    });

    const [creatorUser, adminUsers] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true },
      }),
      this.prisma.user.findMany({
        where: {
          role: {
            in: ['ADMIN', 'MODERATOR'],
          },
        },
        select: { id: true },
      }),
    ]);

    const creatorLabel = creatorUser?.name?.trim() || creatorUser?.email?.trim() || `User ${userId}`;
    const amountLabel = `$${amount.toFixed(2)}`;

    const notificationResults = await Promise.allSettled(
      adminUsers.map((admin) =>
        this.notifications.createNotification({
          userId: admin.id,
          type: 'SYSTEM',
          title: 'Creator payout request',
          body: `${creatorLabel} requested ${amountLabel} for referral payout.`,
          data: {
            route: '/admin/creator-payouts',
            creatorUserId: userId,
            creatorEmail: creatorUser?.email ?? null,
            creatorName: creatorUser?.name ?? null,
            referralCode: account.referralCode,
            payoutId: payout.id,
            amountRequested: amount,
            walletAddress,
          },
        }),
      ),
    );

    const failedNotifications = notificationResults.filter((result) => result.status === 'rejected');
    if (failedNotifications.length > 0) {
      this.logger.warn(
        `Creator payout ${payout.id} created but ${failedNotifications.length} admin notification(s) failed`,
      );
    }

    return payout;
  }

  async settlePayout(params: {
    payoutId: string;
    txHash: string;
    reviewedByUserId?: number;
    note?: string;
  }) {
    const payout = await this.prisma.creatorPayout.findUnique({
      where: { id: params.payoutId },
      include: { creatorAccount: true },
    });
    if (!payout) {
      throw new NotFoundException('Payout not found');
    }
    if (payout.status === 'PAID') {
      return payout;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.creatorPayout.update({
        where: { id: payout.id },
        data: {
          status: 'PAID',
          txHash: params.txHash,
          processedAt: new Date(),
          reviewedAt: new Date(),
          reviewedBy: params.reviewedByUserId,
          failureReason: params.note?.trim() || null,
        },
      });

      await tx.creatorProgramAccount.update({
        where: { id: payout.creatorAccountId },
        data: {
          reservedBalance: { decrement: payout.amountRequested },
          paidBalance: { increment: payout.amountRequested },
        },
      });

      return updated;
    });
  }

  async releasePayoutHold(userId: number, reason?: string) {
    const account = await this.getCreatorAccountByUserId(userId);
    if (!account) {
      throw new NotFoundException('Creator account not found');
    }

    return this.prisma.creatorProgramAccount.update({
      where: { id: account.id },
      data: {
        fraudStatus: 'CLEAR',
        fraudReason: reason || null,
        lastReviewedAt: new Date(),
      },
    });
  }
}
