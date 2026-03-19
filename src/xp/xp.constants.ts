export const XP_DAILY_CAP = 75;
export const START_CONVERSATION_XP_COST = 15;

export const XP_REASONS = {
  SIGNUP: 'signup',
  COMPLETE_PROFILE: 'complete_profile',
  DAILY_LOGIN: 'daily_login',
  LOGIN_STREAK_7: 'login_streak_7',
  LOGIN_STREAK_30: 'login_streak_30',
  FUND_WALLET: 'fund_wallet',
  LISTING_APPROVED_PUBLISHED: 'listing_approved_published',
  AD_APPROVED_PUBLISHED: 'ad_approved_published',
  SHARE_AD: 'share_ad',
  LEAVE_REVIEW: 'leave_review',
  RECEIVE_POSITIVE_REVIEW: 'receive_positive_review',
  ESCROW_COMPLETED: 'escrow_completed',
  START_CONVERSATION: 'start_conversation',
  LEGACY_MIGRATION_ADJUSTMENT: 'legacy_migration_adjustment',
} as const;

export const RS_REASONS = {
  COMPLETE_PROFILE: 'complete_profile',
  DAILY_LOGIN: 'daily_login',
  LOGIN_STREAK_7: 'login_streak_7',
  LOGIN_STREAK_30: 'login_streak_30',
  FUND_WALLET: 'fund_wallet',
  LISTING_APPROVED_PUBLISHED: 'listing_approved_published',
  AD_APPROVED_PUBLISHED: 'ad_approved_published',
  SHARE_AD: 'share_ad',
  LEAVE_REVIEW: 'leave_review',
  RECEIVE_POSITIVE_REVIEW: 'receive_positive_review',
  ESCROW_COMPLETED: 'escrow_completed',
  ACCOUNT_AGE_30_DAYS: 'account_age_30_days',
  ACCOUNT_AGE_90_DAYS: 'account_age_90_days',
  ACCOUNT_AGE_180_DAYS: 'account_age_180_days',
  ACCOUNT_AGE_365_DAYS: 'account_age_365_days',
  LEGACY_MIGRATION_ADJUSTMENT: 'legacy_migration_adjustment',
} as const;

export const XP_VALUES = {
  [XP_REASONS.SIGNUP]: 50,
  [XP_REASONS.COMPLETE_PROFILE]: 25,
  [XP_REASONS.DAILY_LOGIN]: 10,
  [XP_REASONS.LOGIN_STREAK_7]: 30,
  [XP_REASONS.LOGIN_STREAK_30]: 100,
  [XP_REASONS.FUND_WALLET]: 25,
  [XP_REASONS.LISTING_APPROVED_PUBLISHED]: 35,
  [XP_REASONS.AD_APPROVED_PUBLISHED]: 35,
  [XP_REASONS.SHARE_AD]: 5,
  [XP_REASONS.LEAVE_REVIEW]: 15,
  [XP_REASONS.RECEIVE_POSITIVE_REVIEW]: 10,
  [XP_REASONS.ESCROW_COMPLETED]: 50,
  [XP_REASONS.START_CONVERSATION]: 15,
} as const;

export const RANK_SCORE_VALUES = {
  [RS_REASONS.COMPLETE_PROFILE]: 10,
  [RS_REASONS.DAILY_LOGIN]: 1,
  [RS_REASONS.LOGIN_STREAK_7]: 7,
  [RS_REASONS.LOGIN_STREAK_30]: 20,
  [RS_REASONS.FUND_WALLET]: 5,
  [RS_REASONS.LISTING_APPROVED_PUBLISHED]: 15,
  [RS_REASONS.AD_APPROVED_PUBLISHED]: 15,
  [RS_REASONS.SHARE_AD]: 2,
  [RS_REASONS.LEAVE_REVIEW]: 8,
  [RS_REASONS.RECEIVE_POSITIVE_REVIEW]: 10,
  [RS_REASONS.ESCROW_COMPLETED]: 25,
  [RS_REASONS.ACCOUNT_AGE_30_DAYS]: 10,
  [RS_REASONS.ACCOUNT_AGE_90_DAYS]: 20,
  [RS_REASONS.ACCOUNT_AGE_180_DAYS]: 35,
  [RS_REASONS.ACCOUNT_AGE_365_DAYS]: 60,
} as const;

export const XP_CAPPED_REASONS = new Set<string>([
  XP_REASONS.DAILY_LOGIN,
  XP_REASONS.FUND_WALLET,
  XP_REASONS.SHARE_AD,
  XP_REASONS.LEAVE_REVIEW,
  XP_REASONS.RECEIVE_POSITIVE_REVIEW,
]);

export interface RankTierDefinition {
  tier: number;
  level: number;
  badgeName: string;
  emoji: string;
  minRankScore: number;
  minDaysOnPlatform: number;
}

export const RANK_TIERS: RankTierDefinition[] = [
  { tier: 1, level: 1, badgeName: 'Seedling', emoji: '🌱', minRankScore: 0, minDaysOnPlatform: 0 },
  { tier: 2, level: 2, badgeName: 'Sprout', emoji: '🌿', minRankScore: 50, minDaysOnPlatform: 7 },
  { tier: 3, level: 3, badgeName: 'Junior Sapling', emoji: '🌳', minRankScore: 200, minDaysOnPlatform: 30 },
  { tier: 4, level: 4, badgeName: 'Senior Sapling', emoji: '🌲', minRankScore: 600, minDaysOnPlatform: 90 },
  { tier: 5, level: 5, badgeName: 'Diamond Vine', emoji: '💎', minRankScore: 1500, minDaysOnPlatform: 180 },
  { tier: 6, level: 6, badgeName: 'RootMaster', emoji: '👑', minRankScore: 3500, minDaysOnPlatform: 365 },
];

export const ACCOUNT_AGE_MILESTONES = [
  { days: 30, reason: RS_REASONS.ACCOUNT_AGE_30_DAYS, amount: 10 },
  { days: 90, reason: RS_REASONS.ACCOUNT_AGE_90_DAYS, amount: 20 },
  { days: 180, reason: RS_REASONS.ACCOUNT_AGE_180_DAYS, amount: 35 },
  { days: 365, reason: RS_REASONS.ACCOUNT_AGE_365_DAYS, amount: 60 },
] as const;

export function getRankTierDefinition(rankTier: number) {
  return RANK_TIERS.find((tier) => tier.tier === rankTier) ?? RANK_TIERS[0];
}

export function getRankTierForScore(rankScore: number, daysOnPlatform: number) {
  let current = RANK_TIERS[0];
  for (const tier of RANK_TIERS) {
    if (rankScore >= tier.minRankScore && daysOnPlatform >= tier.minDaysOnPlatform) {
      current = tier;
    }
  }
  return current;
}
