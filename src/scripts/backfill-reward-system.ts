import { Prisma, PrismaClient } from '@prisma/client';
import {
  ACCOUNT_AGE_MILESTONES,
  RANK_SCORE_VALUES,
  RS_REASONS,
  XP_REASONS,
  XP_VALUES,
  getRankTierForScore,
} from '../xp/xp.constants';

const prisma = new PrismaClient();

type TxClient = Prisma.TransactionClient;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calculateDaysOnPlatform(createdAt: Date) {
  const created = startOfDay(createdAt);
  const today = startOfDay(new Date());
  return Math.max(Math.floor((today.getTime() - created.getTime()) / 86400000), 0);
}

function isProfileComplete(user: { name: string | null; avatarUrl: string | null; bio: string | null }) {
  return Boolean(user.name?.trim() && user.avatarUrl?.trim() && user.bio?.trim());
}

async function xpEventExists(tx: TxClient, eventKey: string) {
  return tx.xpTransaction.findUnique({ where: { eventKey } });
}

async function rsEventExists(tx: TxClient, eventKey: string) {
  return tx.rankScoreTransaction.findUnique({ where: { eventKey } });
}

async function createXpEvent(
  tx: TxClient,
  userId: number,
  currentBalance: number,
  amount: number,
  reason: string,
  eventKey: string,
  metadata?: Prisma.InputJsonObject,
) {
  if (amount <= 0) {
    return currentBalance;
  }

  const existing = await xpEventExists(tx, eventKey);
  if (existing) {
    return currentBalance;
  }

  const nextBalance = currentBalance + amount;
  await tx.xpTransaction.create({
    data: {
      userId,
      type: 'EARN',
      reason,
      amount,
      balanceAfter: nextBalance,
      eventKey,
      metadata,
    },
  });

  return nextBalance;
}

async function createRankEvent(
  tx: TxClient,
  userId: number,
  currentRankScore: number,
  amount: number,
  reason: string,
  eventKey: string,
  metadata?: Prisma.InputJsonObject,
) {
  if (amount <= 0) {
    return currentRankScore;
  }

  const existing = await rsEventExists(tx, eventKey);
  if (existing) {
    return currentRankScore;
  }

  const nextRankScore = currentRankScore + amount;
  await tx.rankScoreTransaction.create({
    data: {
      userId,
      reason,
      amount,
      rankScoreAfter: nextRankScore,
      eventKey,
      metadata,
    },
  });

  return nextRankScore;
}

async function backfillUser(userId: number) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
        xpBalance: true,
        rankScore: true,
        currentStreakDays: true,
        lastLoginDate: true,
        lastDailyXpAt: true,
        name: true,
        avatarUrl: true,
        bio: true,
        xpTransactions: {
          select: { reason: true, type: true, amount: true },
        },
      },
    });

    if (!user) {
      return;
    }

    let xpBalance = user.xpBalance ?? 0;
    let rankScore = user.rankScore ?? 0;
    const daysOnPlatform = calculateDaysOnPlatform(user.createdAt);
    const breakdown: Record<string, number> = {};

    const countByReason = user.xpTransactions.reduce<Record<string, number>>((acc, txItem) => {
      if (txItem.type !== 'EARN') {
        return acc;
      }
      acc[txItem.reason] = (acc[txItem.reason] ?? 0) + 1;
      return acc;
    }, {});

    const legacyXpEventKey = `xp:legacy_adjustment:reward_system_v1:user:${user.id}`;
    const legacyRsEventKey = `rs:legacy_adjustment:reward_system_v1:user:${user.id}`;

    if (!(await xpEventExists(tx, legacyXpEventKey)) && !(await rsEventExists(tx, legacyRsEventKey))) {
      const signupCount = countByReason.signup ?? 0;
      const dailyLoginCount = countByReason.daily_login ?? 0;
      const fundWalletCount = countByReason.fund_wallet ?? 0;
      const shareAdCount = countByReason.share_ad ?? 0;

      const signupXpDelta = signupCount * (XP_VALUES[XP_REASONS.SIGNUP] - 8);
      const dailyLoginXpDelta = dailyLoginCount * (XP_VALUES[XP_REASONS.DAILY_LOGIN] - 1);
      const dailyLoginRsDelta = dailyLoginCount * RANK_SCORE_VALUES[RS_REASONS.DAILY_LOGIN];
      const fundWalletXpDelta = fundWalletCount * (XP_VALUES[XP_REASONS.FUND_WALLET] - 3);
      const fundWalletRsDelta = fundWalletCount * RANK_SCORE_VALUES[RS_REASONS.FUND_WALLET];
      const shareAdXpDelta = shareAdCount * (XP_VALUES[XP_REASONS.SHARE_AD] - 2);
      const shareAdRsDelta = shareAdCount * RANK_SCORE_VALUES[RS_REASONS.SHARE_AD];

      let completeProfileXpDelta = 0;
      let completeProfileRsDelta = 0;
      const hasCompleteProfileHistory =
        user.xpTransactions.some((txItem) => txItem.reason === XP_REASONS.COMPLETE_PROFILE) ||
        Boolean(await rsEventExists(tx, `rs:user:${user.id}:complete_profile`));

      if (!hasCompleteProfileHistory && isProfileComplete(user)) {
        completeProfileXpDelta = XP_VALUES[XP_REASONS.COMPLETE_PROFILE];
        completeProfileRsDelta = RANK_SCORE_VALUES[RS_REASONS.COMPLETE_PROFILE];
      }

      const totalXpDelta =
        signupXpDelta +
        dailyLoginXpDelta +
        fundWalletXpDelta +
        shareAdXpDelta +
        completeProfileXpDelta;
      const totalRsDelta =
        dailyLoginRsDelta +
        fundWalletRsDelta +
        shareAdRsDelta +
        completeProfileRsDelta;

      if (totalXpDelta > 0 || totalRsDelta > 0) {
        if (signupXpDelta) breakdown.signup = signupXpDelta;
        if (dailyLoginXpDelta) breakdown.daily_login_xp = dailyLoginXpDelta;
        if (dailyLoginRsDelta) breakdown.daily_login_rs = dailyLoginRsDelta;
        if (fundWalletXpDelta) breakdown.fund_wallet_xp = fundWalletXpDelta;
        if (fundWalletRsDelta) breakdown.fund_wallet_rs = fundWalletRsDelta;
        if (shareAdXpDelta) breakdown.share_ad_xp = shareAdXpDelta;
        if (shareAdRsDelta) breakdown.share_ad_rs = shareAdRsDelta;
        if (completeProfileXpDelta) breakdown.complete_profile_xp = completeProfileXpDelta;
        if (completeProfileRsDelta) breakdown.complete_profile_rs = completeProfileRsDelta;

        xpBalance = await createXpEvent(
          tx,
          user.id,
          xpBalance,
          totalXpDelta,
          XP_REASONS.LEGACY_MIGRATION_ADJUSTMENT,
          legacyXpEventKey,
          {
            source: 'reward_system_v1_backfill',
            breakdown,
          },
        );

        rankScore = await createRankEvent(
          tx,
          user.id,
          rankScore,
          totalRsDelta,
          RS_REASONS.LEGACY_MIGRATION_ADJUSTMENT,
          legacyRsEventKey,
          {
            source: 'reward_system_v1_backfill',
            breakdown,
          },
        );
      }
    }

    const publishedListings = await tx.userListing.findMany({
      where: { userId: user.id, status: 'PUBLISHED' },
      select: { id: true },
    });

    for (const listing of publishedListings) {
      xpBalance = await createXpEvent(
        tx,
        user.id,
        xpBalance,
        XP_VALUES[XP_REASONS.LISTING_APPROVED_PUBLISHED],
        XP_REASONS.LISTING_APPROVED_PUBLISHED,
        `xp:listing_approved:${listing.id}`,
        { listingId: listing.id, source: 'reward_system_v1_backfill' },
      );

      rankScore = await createRankEvent(
        tx,
        user.id,
        rankScore,
        RANK_SCORE_VALUES[RS_REASONS.LISTING_APPROVED_PUBLISHED],
        RS_REASONS.LISTING_APPROVED_PUBLISHED,
        `rs:listing_approved:${listing.id}`,
        { listingId: listing.id, source: 'reward_system_v1_backfill' },
      );
    }

    const publishedAds = await tx.marketplaceAd.findMany({
      where: { userId: user.id, status: 'PUBLISHED' },
      select: { id: true },
    });

    for (const ad of publishedAds) {
      xpBalance = await createXpEvent(
        tx,
        user.id,
        xpBalance,
        XP_VALUES[XP_REASONS.AD_APPROVED_PUBLISHED],
        XP_REASONS.AD_APPROVED_PUBLISHED,
        `xp:ad_approved:${ad.id}`,
        { adId: ad.id, source: 'reward_system_v1_backfill' },
      );

      rankScore = await createRankEvent(
        tx,
        user.id,
        rankScore,
        RANK_SCORE_VALUES[RS_REASONS.AD_APPROVED_PUBLISHED],
        RS_REASONS.AD_APPROVED_PUBLISHED,
        `rs:ad_approved:${ad.id}`,
        { adId: ad.id, source: 'reward_system_v1_backfill' },
      );
    }

    const completedEscrows = await tx.escrow.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ posterId: user.id }, { applicantId: user.id }],
      },
      select: { id: true, posterId: true, applicantId: true },
    });

    for (const escrow of completedEscrows) {
      if (escrow.posterId === user.id) {
        xpBalance = await createXpEvent(
          tx,
          user.id,
          xpBalance,
          XP_VALUES[XP_REASONS.ESCROW_COMPLETED],
          XP_REASONS.ESCROW_COMPLETED,
          `xp:escrow_completed:${escrow.id}:poster`,
          { escrowId: escrow.id, role: 'poster', source: 'reward_system_v1_backfill' },
        );

        rankScore = await createRankEvent(
          tx,
          user.id,
          rankScore,
          RANK_SCORE_VALUES[RS_REASONS.ESCROW_COMPLETED],
          RS_REASONS.ESCROW_COMPLETED,
          `rs:escrow_completed:${escrow.id}:poster`,
          { escrowId: escrow.id, role: 'poster', source: 'reward_system_v1_backfill' },
        );
      }

      if (escrow.applicantId === user.id) {
        xpBalance = await createXpEvent(
          tx,
          user.id,
          xpBalance,
          XP_VALUES[XP_REASONS.ESCROW_COMPLETED],
          XP_REASONS.ESCROW_COMPLETED,
          `xp:escrow_completed:${escrow.id}:applicant`,
          { escrowId: escrow.id, role: 'applicant', source: 'reward_system_v1_backfill' },
        );

        rankScore = await createRankEvent(
          tx,
          user.id,
          rankScore,
          RANK_SCORE_VALUES[RS_REASONS.ESCROW_COMPLETED],
          RS_REASONS.ESCROW_COMPLETED,
          `rs:escrow_completed:${escrow.id}:applicant`,
          { escrowId: escrow.id, role: 'applicant', source: 'reward_system_v1_backfill' },
        );
      }
    }

    for (const milestone of ACCOUNT_AGE_MILESTONES) {
      if (daysOnPlatform < milestone.days) {
        continue;
      }

      rankScore = await createRankEvent(
        tx,
        user.id,
        rankScore,
        milestone.amount,
        milestone.reason,
        `rs:account_age:${milestone.days}:user:${user.id}`,
        { milestoneDays: milestone.days, source: 'reward_system_v1_backfill' },
      );
    }

    const nextTier = getRankTierForScore(rankScore, daysOnPlatform);
    await tx.user.update({
      where: { id: user.id },
      data: {
        xpBalance,
        rankScore,
        rankTier: nextTier.tier,
        currentStreakDays: user.currentStreakDays ?? 0,
        lastLoginDate: user.lastLoginDate ?? user.lastDailyXpAt ?? null,
      },
    });
  });
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  for (const user of users) {
    await backfillUser(user.id);
  }

  console.log(`Reward system backfill complete for ${users.length} users.`);
}

main()
  .catch((error) => {
    console.error('Reward system backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
