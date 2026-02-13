import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PricingSeed = {
  kind: 'CATEGORY' | 'ADDON' | 'TIER';
  key: string;
  label: string;
  amount: number;
  metadata?: Record<string, any>;
};

@Injectable()
export class MarketplacePricingService implements OnModuleInit {
  private readonly logger = new Logger(MarketplacePricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    const existing = await this.prisma.marketplacePricing.count();
    if (existing > 0) return;

    const seeds: PricingSeed[] = [
      { kind: 'CATEGORY', key: 'CTO Wanted', label: 'CTO Wanted', amount: 40, metadata: { tier: 4 } },
      { kind: 'CATEGORY', key: 'Developers', label: 'Developers', amount: 25, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Designers', label: 'Designers', amount: 15, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Marketers & Promoters', label: 'Marketers & Promoters', amount: 20, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Community Roles', label: 'Community Roles', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Collaborations & Partnerships', label: 'Collaborations & Partnerships', amount: 15, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Development Services', label: 'Development Services', amount: 25, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Design & Creative', label: 'Design & Creative', amount: 15, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Marketing & Hype', label: 'Marketing & Hype', amount: 20, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Tools & Assets', label: 'Tools & Assets', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Education & Advisory', label: 'Education & Advisory', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Other / Experimental', label: 'Other / Experimental', amount: 0, metadata: { tier: 1 } },
      { kind: 'CATEGORY', key: 'Design & Branding', label: 'Design & Branding', amount: 15, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Shilling & Marketing', label: 'Shilling & Marketing', amount: 20, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Tokenomics & Strategy', label: 'Tokenomics & Strategy', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Advisory & Leadership', label: 'Advisory & Leadership', amount: 20, metadata: { tier: 3 } },
      { kind: 'CATEGORY', key: 'Community & Operations', label: 'Community & Operations', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Project Listings (For Takeover)', label: 'Project Listings (For Takeover)', amount: 40, metadata: { tier: 4 } },
      { kind: 'CATEGORY', key: 'NFT & Art', label: 'NFT & Art', amount: 15, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Tools & Services', label: 'Tools & Services', amount: 10, metadata: { tier: 2 } },
      { kind: 'CATEGORY', key: 'Writing & Content', label: 'Writing & Content', amount: 10, metadata: { tier: 2 } },

      { kind: 'TIER', key: 'FREE', label: 'Free', amount: 0, metadata: { priorityHours: 0 } },
      { kind: 'TIER', key: 'PLUS', label: 'Plus', amount: 5, metadata: { priorityHours: 24 } },
      { kind: 'TIER', key: 'PREMIUM', label: 'Premium', amount: 15, metadata: { priorityDays: 7 } },

      { kind: 'ADDON', key: 'FEATURED_PLACEMENT', label: 'Featured Placement', amount: 20 },
      { kind: 'ADDON', key: 'HOMEPAGE_SPOTLIGHT', label: 'Homepage Spotlight', amount: 35 },
      { kind: 'ADDON', key: 'AUTO_BUMP_1', label: 'Auto-Bump (1 Day)', amount: 3 },
      { kind: 'ADDON', key: 'AUTO_BUMP_3', label: 'Auto-Bump (3 Days)', amount: 7 },
      { kind: 'ADDON', key: 'AUTO_BUMP_7', label: 'Auto-Bump (7 Days)', amount: 15 },
      { kind: 'ADDON', key: 'TOP_OF_DAY_1', label: 'Top of the Day (1 Day)', amount: 5 },
      { kind: 'ADDON', key: 'TOP_OF_DAY_3', label: 'Top of the Day (3 Days)', amount: 10 },
      { kind: 'ADDON', key: 'TOP_OF_DAY_7', label: 'Top of the Day (7 Days)', amount: 15 },
      { kind: 'ADDON', key: 'URGENT_TAG', label: 'Urgent Tag', amount: 10 },
      { kind: 'ADDON', key: 'MULTI_CHAIN_TAG', label: 'Multi-Chain Tag', amount: 5 },
    ];

    await this.prisma.marketplacePricing.createMany({
      data: seeds.map((seed) => ({
        kind: seed.kind as any,
        key: seed.key,
        label: seed.label,
        amount: seed.amount,
        currency: 'USDC',
        active: true,
        metadata: seed.metadata ?? undefined,
      })),
    });

    this.logger.log(`Seeded ${seeds.length} marketplace pricing rows`);
  }

  async getActivePricing() {
    return this.prisma.marketplacePricing.findMany({
      where: { active: true },
      orderBy: [{ kind: 'asc' }, { amount: 'asc' }],
    });
  }

  async getPricingMap() {
    const rows = await this.getActivePricing();
    const category = new Map<string, number>();
    const tier = new Map<string, number>();
    const addon = new Map<string, number>();

    rows.forEach((row) => {
      if (row.kind === 'CATEGORY') category.set(row.key, row.amount);
      if (row.kind === 'TIER') tier.set(row.key, row.amount);
      if (row.kind === 'ADDON') addon.set(row.key, row.amount);
    });

    return { category, tier, addon, rows };
  }
}
