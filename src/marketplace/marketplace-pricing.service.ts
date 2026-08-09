import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  MARKETPLACE_ADDONS,
  MARKETPLACE_TAG_GROUPS,
  MARKETPLACE_TAXONOMY,
  MARKETPLACE_VISIBILITY_BUNDLES,
  MarketplacePostTypeValue,
} from './marketplace-taxonomy';

@Injectable()
export class MarketplacePricingService implements OnModuleInit {
  private readonly logger = new Logger(MarketplacePricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    const categoryIds = MARKETPLACE_TAXONOMY.map((category) => category.id);
    const addonIds = MARKETPLACE_ADDONS.map((addon) => addon.id);
    const storedAddonIds = [...addonIds, 'PAID_EXTENSION'];

    await this.prisma.$transaction(async (tx) => {
      await tx.marketplacePricing.updateMany({
        where: { kind: 'CATEGORY', key: { notIn: categoryIds } },
        data: { active: false },
      });
      await tx.marketplacePricing.updateMany({
        where: { kind: 'ADDON', key: { notIn: storedAddonIds } },
        data: { active: false },
      });
      // Legacy visibility tiers remain in the database for old ads and image
      // limits, but they are no longer a pricing component.
      await tx.marketplacePricing.updateMany({
        where: { kind: 'TIER' },
        data: { active: false, amount: 0 },
      });

      for (const category of MARKETPLACE_TAXONOMY) {
        await tx.marketplacePricing.upsert({
          where: { kind_key: { kind: 'CATEGORY', key: category.id } },
          create: {
            kind: 'CATEGORY',
            key: category.id,
            label: category.name,
            amount: category.defaultPriceUsd,
            currency: 'USDC',
            active: true,
            metadata: {
              postTypes: category.postTypes,
              defaultPostType: category.defaultPostType,
              aliases: category.aliases || [],
              subcategories: category.subcategories,
              taxonomyVersion: '2026-08-09',
            },
          },
          update: {
            label: category.name,
            active: true,
          },
        });
      }

      for (const addon of MARKETPLACE_ADDONS) {
        await tx.marketplacePricing.upsert({
          where: { kind_key: { kind: 'ADDON', key: addon.id } },
          create: {
            kind: 'ADDON',
            key: addon.id,
            label: addon.name,
            amount: addon.priceUsd,
            currency: 'USDC',
            active: true,
          },
          update: {
            label: addon.name,
            active: true,
          },
        });
      }

      await tx.marketplacePricing.upsert({
        where: { kind_key: { kind: 'ADDON', key: 'PAID_EXTENSION' } },
        create: {
          kind: 'ADDON',
          key: 'PAID_EXTENSION',
          label: 'Paid Listing Extension',
          amount: 0,
          currency: 'USDC',
          active: false,
          metadata: { requiresProductApproval: true },
        },
        update: {},
      });
    });

    this.logger.log(`Marketplace taxonomy synchronized: ${categoryIds.length} categories, ${addonIds.length} add-ons`);
  }

  async getActivePricing() {
    return this.prisma.marketplacePricing.findMany({
      where: { active: true },
      orderBy: [{ kind: 'asc' }, { amount: 'asc' }, { label: 'asc' }],
    });
  }

  async getPricingMap() {
    const rows = await this.getActivePricing();
    const category = new Map<string, number>();
    const subcategory = new Map<string, number>();
    const tier = new Map<string, number>();
    const addon = new Map<string, number>();

    rows.forEach((row) => {
      if (row.kind === 'CATEGORY') {
        category.set(row.key, row.amount);
        const metadata = (row.metadata || {}) as any;
        const categoryKeys = [row.key, row.label, ...(metadata.aliases || [])];
        for (const categoryKey of categoryKeys) category.set(String(categoryKey), row.amount);
        for (const item of metadata.subcategories || []) {
          if (item?.active !== false && item?.id) {
            const price = Number(item.priceUsd ?? row.amount);
            const subcategoryKeys = [item.id, item.name, ...(item.aliases || [])];
            for (const categoryKey of categoryKeys) {
              for (const subcategoryKey of subcategoryKeys) {
                subcategory.set(`${categoryKey}:${subcategoryKey}`, price);
              }
            }
          }
        }
      }
      if (row.kind === 'TIER') tier.set(row.key, 0);
      if (row.kind === 'ADDON') addon.set(row.key, row.amount);
    });

    return { category, subcategory, tier, addon, rows };
  }

  async resolveSelection(categoryInput: string, subcategoryInput?: string | null) {
    const rows = await this.getActivePricing();
    const normalizedCategory = this.normalize(categoryInput);
    const categoryRow = rows.find((row) => {
      if (row.kind !== 'CATEGORY') return false;
      const metadata = (row.metadata || {}) as any;
      const candidates = [row.key, row.label, ...(metadata.aliases || [])];
      return candidates.some((candidate) => this.normalize(candidate) === normalizedCategory);
    });

    if (!categoryRow) {
      throw new BadRequestException(`Unknown or inactive marketplace category: ${categoryInput}`);
    }

    const metadata = (categoryRow.metadata || {}) as any;
    const subcategories = Array.isArray(metadata.subcategories) ? metadata.subcategories : [];
    const subcategoryPrices = new Set(
      subcategories.filter((item: any) => item?.active !== false).map((item: any) => Number(item.priceUsd)),
    );
    if (!subcategoryInput && subcategoryPrices.size > 1) {
      throw new BadRequestException(`A subcategory is required for ${categoryRow.label} pricing`);
    }
    let selectedSubcategory: any = null;
    if (subcategoryInput) {
      const normalizedSubcategory = this.normalize(subcategoryInput);
      selectedSubcategory = subcategories.find((item: any) => {
        if (item?.active === false) return false;
        const candidates = [item.id, item.name, ...(item.aliases || [])];
        return candidates.some((candidate) => this.normalize(candidate) === normalizedSubcategory);
      });
      if (!selectedSubcategory) {
        throw new BadRequestException(
          `Unknown or inactive subcategory "${subcategoryInput}" for ${categoryRow.label}`,
        );
      }
    }

    const postTypes = (metadata.postTypes || ['LOOKING_FOR', 'OFFERING']) as MarketplacePostTypeValue[];
    return {
      categoryId: categoryRow.key,
      categoryLabel: categoryRow.label,
      subcategoryId: selectedSubcategory?.id ?? null,
      subcategoryLabel: selectedSubcategory?.name ?? null,
      listingFeeUsd: Number(selectedSubcategory?.priceUsd ?? categoryRow.amount),
      postTypes,
      defaultPostType: (metadata.defaultPostType || postTypes[0] || 'LOOKING_FOR') as MarketplacePostTypeValue,
    };
  }

  async resolveCategoryId(categoryInput: string) {
    const rows = await this.getActivePricing();
    const normalizedCategory = this.normalize(categoryInput);
    const categoryRow = rows.find((row) => {
      if (row.kind !== 'CATEGORY') return false;
      const metadata = (row.metadata || {}) as any;
      return [row.key, row.label, ...(metadata.aliases || [])]
        .some((candidate) => this.normalize(candidate) === normalizedCategory);
    });
    if (!categoryRow) {
      throw new BadRequestException(`Unknown or inactive marketplace category: ${categoryInput}`);
    }
    return categoryRow.key;
  }

  async getCatalog() {
    const rows = await this.getActivePricing();
    const categories = rows
      .filter((row) => row.kind === 'CATEGORY')
      .map((row) => {
        const metadata = (row.metadata || {}) as any;
        return {
          id: row.key,
          name: row.label,
          postTypes: metadata.postTypes || ['LOOKING_FOR', 'OFFERING'],
          defaultPostType: metadata.defaultPostType || 'LOOKING_FOR',
          defaultPriceUsd: row.amount,
          active: row.active,
          subcategories: (metadata.subcategories || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            priceUsd: Number(item.priceUsd ?? row.amount),
            active: item.active !== false,
          })),
        };
      });
    const addons = rows
      .filter((row) => row.kind === 'ADDON' && row.key !== 'PAID_EXTENSION')
      .map((row) => ({ id: row.key, name: row.label, priceUsd: row.amount, active: row.active }));
    const bundlesEnabled = this.config.get<string>('MARKETPLACE_BUNDLES_ENABLED', 'false') === 'true';

    return {
      taxonomyVersion: '2026-08-09',
      currency: 'USDC',
      pricingFormula: 'listingFee + selectedAddons',
      defaultLifetimeDays: 28,
      categories,
      addons,
      tagGroups: MARKETPLACE_TAG_GROUPS,
      bundles: MARKETPLACE_VISIBILITY_BUNDLES.map((bundle) => ({ ...bundle, enabled: bundlesEnabled })),
      legacyVisibilityTierPricingEnabled: false,
    };
  }

  async updatePricing(
    kindInput: string,
    key: string,
    update: { amount?: number; active?: boolean; label?: string; metadata?: Record<string, any> },
  ) {
    const kind = String(kindInput || '').toUpperCase();
    if (!['CATEGORY', 'ADDON'].includes(kind)) {
      throw new BadRequestException('Only CATEGORY and ADDON pricing can be edited');
    }
    const existing = await this.prisma.marketplacePricing.findUnique({
      where: { kind_key: { kind: kind as any, key } },
    });
    if (!existing) throw new BadRequestException(`Pricing row not found: ${kind}:${key}`);

    const metadata = update.metadata
      ? { ...((existing.metadata || {}) as any), ...update.metadata }
      : undefined;
    return this.prisma.marketplacePricing.update({
      where: { kind_key: { kind: kind as any, key } },
      data: {
        amount: update.amount,
        active: update.active,
        label: update.label,
        metadata,
      },
    });
  }

  normalizePostType(input: string | undefined, allowed: MarketplacePostTypeValue[], fallback: MarketplacePostTypeValue) {
    const normalized = String(input || fallback).trim().toUpperCase() as MarketplacePostTypeValue;
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(`Post type ${input} is not allowed for the selected category`);
    }
    return normalized;
  }

  private normalize(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
}
