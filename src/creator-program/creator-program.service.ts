import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CreatorEarningStatus, CreatorEarningType, CreatorPayoutStatus, CreatorReferralStatus, CreatorTier, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { XpService } from '../xp/xp.service';

type CreatorFraudStatus = 'CLEAR' | 'REVIEW' | 'HOLD';

const MIN_PAYOUT_USD = 10;
const WALLET_CHANGE_COOLDOWN_DAYS = 30;
const WALLET_ACTIVATION_HOURS = 72;

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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function isValidSolanaAddress(address: string) {
  const normalized = address.trim();
  return normalized.length >= 32 && normalized.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(normalized);
}

@Injectable()
export class CreatorProgramService {
  private readonly logger = new Logger(CreatorProgramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly jwtService: JwtService,
    private readonly xpService: XpService,
  ) {}

  private get frontendBaseUrl() {
    return (
      this.configService.get<string>('APP_FRONTEND_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      this.configService.get<string>('NEXT_PUBLIC_FRONTEND_URL') ||
      'https://app.ctomarketplace.com'
    ).replace(/\/$/, '');
  }

  private get creatorLandingPageUrl() {
    return (
      this.configService.get<string>('CREATOR_LANDING_PAGE_URL') ||
      this.configService.get<string>('CREATOR_LANDING_URL') ||
      this.frontendBaseUrl
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

  private isAccountDeactivated(account: {
    isDeactivated?: boolean;
    deactivatedAt?: Date | null;
  } | null | undefined) {
    return Boolean(account?.isDeactivated || account?.deactivatedAt);
  }

  private mapWalletChange(account: {
    payoutWalletAddress?: string | null;
    payoutWalletChangePendingAddress?: string | null;
    payoutWalletLastChangedAt?: Date | null;
    payoutWalletChangePendingUntil?: Date | null;
    nextPayoutWalletChangeAllowedAt?: Date | null;
  }, activeWalletAddress?: string | null) {
    return {
      activeWalletAddress: activeWalletAddress || account.payoutWalletAddress || '',
      pendingWalletAddress: account.payoutWalletChangePendingAddress ?? undefined,
      walletLastChanged: account.payoutWalletLastChangedAt?.toISOString() ?? undefined,
      walletChangePendingUntil: account.payoutWalletChangePendingUntil?.toISOString() ?? undefined,
      nextWalletChangeAllowed: account.nextPayoutWalletChangeAllowedAt?.toISOString() ?? undefined,
    };
  }

  private async finalizePendingWalletChangeTx(tx: Prisma.TransactionClient, account: {
    id: string;
    payoutWalletAddress?: string | null;
    payoutWalletChangePendingAddress?: string | null;
    payoutWalletChangePendingUntil?: Date | null;
    payoutWalletLastChangedAt?: Date | null;
  }) {
    if (!account.payoutWalletChangePendingAddress || !account.payoutWalletChangePendingUntil) {
      return account;
    }

    if (account.payoutWalletChangePendingUntil.getTime() > Date.now()) {
      return account;
    }

    const now = new Date();
    return tx.creatorProgramAccount.update({
      where: { id: account.id },
      data: {
        payoutWalletAddress: account.payoutWalletChangePendingAddress,
        payoutWalletChangePendingAddress: null,
        payoutWalletChangePendingUntil: null,
        payoutWalletLastChangedAt: now,
        nextPayoutWalletChangeAllowedAt: addDays(now, WALLET_CHANGE_COOLDOWN_DAYS),
      },
    });
  }

  private async getActiveCreatorAccountTx(tx: Prisma.TransactionClient, userId: number) {
    const account = await this.requireCreatorAccountTx(tx, userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
    return this.finalizePendingWalletChangeTx(tx, account as any);
  }

  private async getActiveCreatorAccount(userId: number): Promise<any> {
    return this.prisma.$transaction((tx) => this.getActiveCreatorAccountTx(tx, userId));
  }

  private async getDefaultSolanaWallet(userId: number) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, blockchain: 'SOLANA' },
      orderBy: { isPrimary: 'desc' },
      select: { address: true },
    });
    return wallet?.address || '';
  }

  private mapPayoutStatus(status: CreatorPayoutStatus) {
    if (status === 'PAID') return 'paid';
    if (status === 'APPROVED') return 'approved';
    if (status === 'REJECTED') return 'rejected';
    return 'pending';
  }

  private mapEarningType(type: CreatorEarningType) {
    return type === 'ESCROW_FEE' ? 'escrow_deal' : 'ad_fee';
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

  private async requireCreatorAccountTx(tx: Prisma.TransactionClient, userId: number) {
    const account = await tx.creatorProgramAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException('Join the Creator Program before accessing creator tools');
    }
    return account;
  }

  private async requireCreatorAccount(userId: number) {
    return this.prisma.$transaction((tx) => this.requireCreatorAccountTx(tx, userId));
  }

  async signup(data: { email: string; password: string; name?: string; referralCode?: string }) {
    const bcrypt = await import('bcryptjs');
    const normalizedEmail = data.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new BadRequestException('A user with this email already exists');
    }

    const existingCreator = await this.prisma.creatorProgramAccount.findFirst({
      where: { user: { email: normalizedEmail } },
    });
    if (existingCreator) {
      throw new BadRequestException('A creator account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: data.name?.trim() || null,
          passwordHash,
        },
      });

      const referralCode = await this.generateUniqueReferralCode(tx, user.id);
      const referralLink = this.getReferralLink(referralCode);

      const creatorAccount = await tx.creatorProgramAccount.create({
        data: {
          userId: user.id,
          referralCode,
          referralLink,
          tier: 'STARTER',
        },
      });

      return { user, creatorAccount };
    });

    if (data.referralCode?.trim()) {
      await this.captureReferral({
        referredUserId: result.user.id,
        referralCode: data.referralCode.trim(),
        referralSource: 'CREATOR_SIGNUP',
      }).catch((err) => {
        this.logger.warn(`Referral capture failed for creator signup: ${err.message}`);
      });
    }

    const payload = { email: result.user.email, sub: result.user.id, role: result.user.role };
    const token = this.jwtService.sign(payload, { expiresIn: '24h' });

    return {
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
      creatorAccount: {
        id: result.creatorAccount.id,
        referralCode: result.creatorAccount.referralCode,
        referralLink: result.creatorAccount.referralLink,
        tier: result.creatorAccount.tier,
      },
      token,
    };
  }

  async createSessionHandoff(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ticket: this.jwtService.sign(
        { sub: user.id, email: user.email, role: user.role, purpose: 'creator_handoff' },
        { expiresIn: '2m' },
      ),
      expiresInSeconds: 120,
    };
  }

  async exchangeSessionHandoff(ticket: string) {
    if (!ticket?.trim()) {
      throw new BadRequestException('Creator session ticket is required');
    }

    try {
      const payload = this.jwtService.verify(ticket.trim()) as {
        sub?: number;
        email?: string;
        role?: string;
        purpose?: string;
      };
      if (!payload?.sub || payload.purpose !== 'creator_handoff') {
        throw new BadRequestException('Invalid creator session ticket');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: Number(payload.sub) },
        select: { id: true, email: true, role: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      return {
        token: this.jwtService.sign(
          { email: user.email, sub: user.id, role: user.role },
          { expiresIn: '24h' },
        ),
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Creator session ticket is invalid or expired');
    }
  }
  async getEnrollmentStatus(userId: number) {
    const account = await this.getCreatorAccountByUserId(userId);
    return {
      enrolled: Boolean(account && !this.isAccountDeactivated(account)),
      deactivated: Boolean(account && this.isAccountDeactivated(account)),
      referralCode: account?.referralCode,
    };
  }

  async enroll(userId: number) {
    const account = await this.prisma.$transaction((tx) => this.ensureCreatorAccountTx(tx, userId));
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }

    return {
      enrolled: true,
      referralCode: account.referralCode,
      referralLink: this.getReferralLink(account.referralCode),
      dashboardPath: '/creator',
    };
  }
  private async getCreatorAccountByUserId(userId: number) {
    return this.prisma.creatorProgramAccount.findUnique({
      where: { userId },
    });
  }

  async getReferralLinkForUser(userId: number) {
    const account = await this.requireCreatorAccount(userId);
    return {
      referralCode: account.referralCode,
      referralLink: this.getReferralLink(account.referralCode),
      landingPageUrl: `${this.creatorLandingPageUrl}/creator-signup?ref=${account.referralCode}`,
    };
  }

  async getReferralCode(userId: number) {
    return this.getReferralLinkForUser(userId);
  }

  async getSettings(userId: number) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }

    const [user, wallets] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          updatedAt: true,
        },
      }),
      this.prisma.wallet.findMany({
        where: { userId },
        orderBy: { isPrimary: 'desc' },
        select: {
          blockchain: true,
          address: true,
          type: true,
          walletClient: true,
          isPrimary: true,
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activeWalletAddress =
      account.payoutWalletAddress ||
      wallets.find((wallet) => wallet.blockchain === 'SOLANA')?.address ||
      wallets[0]?.address ||
      '';

    return {
      username: user.name ?? '',
      email: user.email,
      profileImageUrl: user.avatarUrl ?? undefined,
      usernameLocked: Boolean(user.name?.trim()),
      accountDeactivated: Boolean(account.isDeactivated),
      deactivatedAt: account.deactivatedAt?.toISOString() ?? undefined,
      walletChange: this.mapWalletChange(account as any, activeWalletAddress),
      wallets: wallets.map((wallet) => ({
        chain: String(wallet.blockchain).toLowerCase() === 'solana' ? 'solana' : 'base',
        address: wallet.address || '',
        label:
          String(wallet.blockchain).toLowerCase() === 'solana'
            ? 'Solana USDC'
            : 'Base USDC',
      })),
    };
  }

  async updateSettings(userId: number, payload: { username?: string; profileImageUrl?: string }) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const nextName = payload.username?.trim();
    if (!user.name?.trim() && !nextName) {
      throw new BadRequestException('Username is required');
    }
    if (user.name?.trim() && nextName && nextName !== user.name.trim()) {
      throw new BadRequestException('Username can only be changed once');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: user.name?.trim() ? user.name : nextName,
        avatarUrl: payload.profileImageUrl?.trim() || null,
      },
    });

    return this.getSettings(userId);
  }

  async updatePayoutWallet(userId: number, walletAddress: string, chain = 'solana') {
    if (chain !== 'solana') {
      throw new BadRequestException('Only Solana USDC payouts are supported currently');
    }

    const account = await this.getActiveCreatorAccount(userId);
    const normalized = walletAddress.trim();
    if (!normalized) {
      throw new BadRequestException('Wallet address is required');
    }
    if (!isValidSolanaAddress(normalized)) {
      throw new BadRequestException('Enter a valid Solana wallet address');
    }

    const activeWalletAddress = account.payoutWalletAddress || await this.getDefaultSolanaWallet(userId);
    if (normalized === activeWalletAddress) {
      throw new BadRequestException('This is already your active payout wallet');
    }

    const now = new Date();
    if (account.nextPayoutWalletChangeAllowedAt && account.nextPayoutWalletChangeAllowedAt.getTime() > now.getTime()) {
      throw new BadRequestException('You can only change your payout wallet once every 30 days');
    }

    await this.prisma.creatorProgramAccount.update({
      where: { id: account.id },
      data: {
        payoutWalletChangePendingAddress: normalized,
        payoutWalletChangePendingUntil: addHours(now, WALLET_ACTIVATION_HOURS),
        nextPayoutWalletChangeAllowedAt: addDays(now, WALLET_CHANGE_COOLDOWN_DAYS),
      },
    });

    return this.getPayoutsData(userId);
  }

  async resetPassword(userId: number, payload: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user?.passwordHash) {
      throw new BadRequestException('Password reset is not available for this account');
    }

    if (!payload.currentPassword || !payload.newPassword || !payload.confirmPassword) {
      throw new BadRequestException('All password fields are required');
    }
    if (payload.newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    if (payload.newPassword !== payload.confirmPassword) {
      throw new BadRequestException('New passwords do not match');
    }

    const bcrypt = await import('bcryptjs');
    const currentValid = await bcrypt.compare(payload.currentPassword, user.passwordHash);
    if (!currentValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const nextHash = await bcrypt.hash(payload.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: nextHash },
    });

    return { success: true };
  }

  async deactivateCreatorAccount(userId: number) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      return { success: true };
    }

    await this.prisma.creatorProgramAccount.update({
      where: { id: account.id },
      data: {
        isDeactivated: true,
        deactivatedAt: new Date(),
        fraudStatus: 'HOLD',
        fraudReason: 'Deactivated by creator',
      },
    });

    return { success: true };
  }

  async getDashboard(userId: number, recentLimit = 20) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
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

  async getDashboardData(userId: number) {
    const account = await this.getActiveCreatorAccount(userId);
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [newReferralsThisWeek, earnings] = await Promise.all([
      this.prisma.creatorReferral.count({ where: { creatorUserId: userId, signedUpAt: { gte: weekAgo } } }),
      this.prisma.creatorEarning.findMany({
        where: { creatorUserId: userId, createdAt: { gte: thirtyDaysAgo }, status: { not: 'REVERSED' } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const daily = new Map<string, number>();
    for (const earning of earnings) {
      const date = toDayKey(earning.createdAt);
      daily.set(date, (daily.get(date) || 0) + earning.amountEarned);
    }
    const monthStart = startOfMonth(now);
    const nextTierTarget = this.nextTierTarget(account.activeReferralsCount);
    return {
      totalReferrals: account.totalReferralsCount,
      newReferralsThisWeek,
      thisMonthEarnings: earnings.filter((earning) => earning.createdAt >= monthStart).reduce((sum, earning) => sum + earning.amountEarned, 0),
      currentTier: account.tier,
      tierCutPercent: this.getCutPercent(account.activeReferralsCount),
      referralsForNextTier: nextTierTarget == null ? 0 : Math.max(nextTierTarget - account.activeReferralsCount, 0),
      activeReferrals: account.activeReferralsCount,
      pendingPayout: account.pendingBalance,
      earningsLast30Days: Array.from(daily.entries()).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getReferralsData(userId: number, limit = 50) {
    await this.getActiveCreatorAccount(userId);
    const referrals = await this.prisma.creatorReferral.findMany({
      where: { creatorUserId: userId }, orderBy: { signedUpAt: 'desc' }, take: limit,
      include: { referredUser: { select: { id: true, email: true, name: true, wallets: { where: { blockchain: 'SOLANA' }, orderBy: { isPrimary: 'desc' }, take: 1, select: { address: true } } } } },
    });
    return { referrals: referrals.map((referral) => ({
      id: referral.id,
      username: referral.referredUser.name || referral.referredUser.email || undefined,
      wallet: referral.referredUser.wallets[0]?.address || '',
      dateJoined: referral.signedUpAt.toISOString(),
      status: referral.isActive && !referral.isFraudFlagged ? 'active' : 'inactive',
      generated: referral.totalEarned,
    })) };
  }

  async getEarningsData(userId: number, limit = 50) {
    const account = await this.getActiveCreatorAccount(userId);
    const earnings = await this.prisma.creatorEarning.findMany({ where: { creatorUserId: userId }, orderBy: { createdAt: 'desc' }, take: limit });
    const monthStart = startOfMonth();
    return {
      totalEarned: account.totalEarned,
      thisMonth: earnings.filter((earning) => earning.status !== 'REVERSED' && earning.createdAt >= monthStart).reduce((sum, earning) => sum + earning.amountEarned, 0),
      transactions: earnings.map((earning) => ({ id: earning.id, date: earning.createdAt.toISOString(), type: this.mapEarningType(earning.sourceType), dealAmount: earning.amountGross, yourCut: earning.amountEarned, status: earning.status === 'PAID' ? 'paid' : 'pending' })),
    };
  }

  async getPayoutsData(userId: number, limit = 20) {
    const account = await this.getActiveCreatorAccount(userId);
    const payouts = await this.prisma.creatorPayout.findMany({ where: { creatorUserId: userId }, orderBy: { createdAt: 'desc' }, take: limit });
    const activeWalletAddress = account.payoutWalletAddress || await this.getDefaultSolanaWallet(userId);
    return {
      availableBalance: account.pendingBalance,
      totalPaidOut: account.paidBalance,
      savedWalletAddress: activeWalletAddress || undefined,
      savedChain: 'solana',
      walletChange: this.mapWalletChange(account as any, activeWalletAddress),
      payouts: payouts.map((payout) => ({ id: payout.id, dateRequested: payout.createdAt.toISOString(), amount: payout.amountApproved ?? payout.amountRequested, wallet: payout.walletAddress, chain: 'solana', status: this.mapPayoutStatus(payout.status), notes: payout.failureReason || payout.requestNote || undefined })),
    };
  }

  async getReferrals(userId: number, limit = 50) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
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
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
    const earnings = await this.prisma.creatorEarning.findMany({
      where: { creatorUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { success: true, earnings };
  }

  async getPayouts(userId: number, limit = 20) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
    const payouts = await this.prisma.creatorPayout.findMany({
      where: { creatorUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { success: true, payouts };
  }

  async getNotifications(userId: number) {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const mapped = notifications
      .map((notification) => {
        const creatorType = (notification.data as any)?.creatorNotificationType;
        if (!creatorType) return null;
        return {
          id: notification.id,
          type: creatorType,
          title: notification.title,
          message: notification.body ?? '',
          referralId: (notification.data as any)?.referralId,
          earningId: (notification.data as any)?.earningId,
          payoutId: (notification.data as any)?.payoutId,
          amount: (notification.data as any)?.amountRequested ?? (notification.data as any)?.amountEarned,
          wallet: (notification.data as any)?.walletAddress,
          createdAt: notification.createdAt.toISOString(),
          read: Boolean(notification.readAt),
        };
      })
      .filter(Boolean);

    return {
      notifications: mapped,
      unreadCount: mapped.filter((item) => !item.read).length,
    };
  }

  async markNotificationRead(userId: number, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return updated;
  }

  async markAllNotificationsRead(userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async removeNotification(userId: number, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({ where: { id } });
    return { id, deleted: true };
  }

  async clearAllNotifications(userId: number) {
    await this.prisma.notification.deleteMany({ where: { userId } });
    return { success: true };
  }

  async simulateCreatorNotification(userId: number, type: 'referral' | 'earning' | 'payout') {
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
    const payload =
      type === 'earning'
        ? {
            creatorNotificationType: 'new_earning' as const,
            title: 'New earning',
            body: 'A new creator earning was recorded.',
          }
        : type === 'payout'
          ? {
              creatorNotificationType: 'payout_paid' as const,
              title: 'Payout paid',
              body: 'Your payout was marked paid.',
            }
          : {
              creatorNotificationType: 'new_referral' as const,
              title: 'New referral signup',
              body: 'A new user joined through your referral link.',
            };

    const notification = await this.notifications.createNotification({
      userId,
      type: 'SYSTEM',
      title: payload.title,
      body: payload.body,
      data: {
        creatorNotificationType: payload.creatorNotificationType,
      },
    });

    return notification;
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

      await this.notifications.createNotification({
        userId: creatorAccount.userId,
        type: 'SYSTEM',
        title: 'New referral signup',
        body: `${params.referralSource ?? 'A new user'} joined through your referral link.`,
        data: {
          creatorNotificationType: 'new_referral',
          referralId: referral.id,
          referredUserId: params.referredUserId,
          referralCode: normalizedCode,
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

      const account = await this.requireCreatorAccountTx(tx, referral.creatorUserId!);
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

    const account = await this.requireCreatorAccount(params.creatorUserId);
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

    await this.notifications.createNotification({
      userId: params.creatorUserId,
      type: 'SYSTEM',
      title: 'New earning',
      body: `${params.sourceType} generated $${amountEarned.toFixed(2)} for you.`,
      data: {
        creatorNotificationType: 'new_earning',
        earningId: earning.id,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        amountEarned,
      },
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
    const account = await this.requireCreatorAccount(userId);
    if (this.isAccountDeactivated(account)) {
      throw new ForbiddenException('Creator account is deactivated');
    }
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

    const updated = await this.prisma.$transaction(async (tx) => {
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

    await this.notifications.createNotification({
      userId: payout.creatorUserId,
      type: 'SYSTEM',
      title: 'Payout paid',
      body: `Your payout of $${payout.amountRequested.toFixed(2)} has been marked paid.`,
      data: {
        creatorNotificationType: 'payout_paid',
        payoutId: updated.id,
        amountRequested: payout.amountRequested,
        walletAddress: payout.walletAddress,
        txHash: params.txHash,
      },
    });

    return updated;
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
