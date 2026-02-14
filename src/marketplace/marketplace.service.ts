import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MovementPaymentService } from '../payment/movement-payment.service';
import { MarketplacePricingService } from './marketplace-pricing.service';
import { CreateMarketplaceAdDto } from './dto/create-marketplace-ad.dto';
import { UpdateMarketplaceAdDto } from './dto/update-marketplace-ad.dto';

type PricingBreakdown = {
  baseCategory: number;
  tier: number;
  addOns: number;
  total: number;
  missingCategoryPrice: boolean;
};

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);
  private readonly baseExpiryDays = 28;
  private readonly freeExtensionLimit = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movementPaymentService: MovementPaymentService,
    private readonly pricingService: MarketplacePricingService,
  ) {}

  private normalizeImages(images?: string[]) {
    if (!images) return [];
    return images.filter(Boolean);
  }

  private maxImagesForTier(tier: string) {
    return tier === 'PLUS' || tier === 'PREMIUM' ? 5 : 3;
  }

  private validateImages(tier: string, images: string[]) {
    const max = this.maxImagesForTier(tier);
    if (images.length > max) {
      throw new BadRequestException(`Image limit exceeded. ${tier} allows up to ${max} images.`);
    }
  }

  private buildPricingBreakdown(ad: any, pricing: Awaited<ReturnType<MarketplacePricingService['getPricingMap']>>): PricingBreakdown {
    // Category/role pricing is not charged. Only tier + add-ons apply.
    const baseCategory = 0;
    const tier = pricing.tier.get(ad.tier) ?? 0;
    let addOns = 0;

    if (ad.featuredPlacement) addOns += pricing.addon.get('FEATURED_PLACEMENT') ?? 0;
    if (ad.homepageSpotlight) addOns += pricing.addon.get('HOMEPAGE_SPOTLIGHT') ?? 0;
    if (ad.topOfDayDays === 1) addOns += pricing.addon.get('TOP_OF_DAY_1') ?? 0;
    if (ad.topOfDayDays === 3) addOns += pricing.addon.get('TOP_OF_DAY_3') ?? 0;
    if (ad.topOfDayDays === 7) addOns += pricing.addon.get('TOP_OF_DAY_7') ?? 0;
    if (ad.autoBumpDays === 1) addOns += pricing.addon.get('AUTO_BUMP_1') ?? 0;
    if (ad.autoBumpDays === 3) addOns += pricing.addon.get('AUTO_BUMP_3') ?? 0;
    if (ad.autoBumpDays === 7) addOns += pricing.addon.get('AUTO_BUMP_7') ?? 0;
    if (ad.urgentTag) addOns += pricing.addon.get('URGENT_TAG') ?? 0;
    if (ad.multiChainTag) addOns += pricing.addon.get('MULTI_CHAIN_TAG') ?? 0;

    return {
      baseCategory,
      tier,
      addOns,
      total: baseCategory + tier + addOns,
      missingCategoryPrice: false,
    };
  }

  async getPricing() {
    const rows = await this.pricingService.getActivePricing();
    return { success: true, items: rows };
  }

  async createDraft(userId: number, dto: CreateMarketplaceAdDto) {
    if (!userId) throw new ForbiddenException('Authentication required');

    const tier = dto.tier || 'FREE';
    const images = this.normalizeImages(dto.images);
    this.validateImages(tier, images);

    const created = await this.prisma.marketplaceAd.create({
      data: {
        userId,
        postType: (dto.postType as any) || 'LOOKING_FOR',
        category: dto.category,
        subCategory: dto.subCategory ?? null,
        title: dto.title,
        description: dto.description,
        tags: dto.tags ?? [],
        contactInfo: dto.contactInfo ?? null,
        chain: dto.chain as any,
        offerType: dto.offerType ?? null,
        priceAmount: dto.priceAmount ?? null,
        priceCurrency: dto.priceCurrency ?? 'USDC',
        images,
        imageCount: images.length,
        tier: tier as any,
        featuredPlacement: dto.featuredPlacement ?? false,
        homepageSpotlight: dto.homepageSpotlight ?? false,
        topOfDayDays: dto.topOfDayDays ?? null,
        autoBumpDays: dto.autoBumpDays ?? null,
        urgentTag: dto.urgentTag ?? false,
        multiChainTag: dto.multiChainTag ?? false,
        status: 'DRAFT',
      },
    });

    return { success: true, data: created };
  }

  async updateDraft(userId: number, id: string, dto: UpdateMarketplaceAdDto) {
    const found = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Ad not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your ad');
    if (['PUBLISHED', 'EXPIRED', 'SOLD'].includes(found.status)) {
      throw new BadRequestException('Cannot modify a published or expired ad');
    }

    const tier = (dto.tier ?? found.tier) as string;
    const images = this.normalizeImages(dto.images ?? (found.images as string[] | undefined));
    this.validateImages(tier, images);

    const updated = await this.prisma.marketplaceAd.update({
      where: { id },
      data: {
        postType: (dto.postType as any) ?? found.postType,
        category: dto.category ?? found.category,
        subCategory: dto.subCategory ?? found.subCategory,
        title: dto.title ?? found.title,
        description: dto.description ?? found.description,
        tags: dto.tags ?? (found.tags as any),
        contactInfo: dto.contactInfo ?? found.contactInfo,
        chain: (dto.chain as any) ?? found.chain,
        offerType: dto.offerType ?? found.offerType,
        priceAmount: dto.priceAmount ?? found.priceAmount,
        priceCurrency: dto.priceCurrency ?? found.priceCurrency,
        images,
        imageCount: images.length,
        tier: tier as any,
        featuredPlacement: dto.featuredPlacement ?? found.featuredPlacement,
        homepageSpotlight: dto.homepageSpotlight ?? found.homepageSpotlight,
        topOfDayDays: dto.topOfDayDays ?? found.topOfDayDays,
        autoBumpDays: dto.autoBumpDays ?? found.autoBumpDays,
        urgentTag: dto.urgentTag ?? found.urgentTag,
        multiChainTag: dto.multiChainTag ?? found.multiChainTag,
      },
    });

    return { success: true, data: updated };
  }

  async listMine(userId: number) {
    if (!userId) throw new ForbiddenException('Authentication required');
    const items = await this.prisma.marketplaceAd.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, items };
  }

  async listPublic(params: { page?: number; limit?: number; category?: string; subCategory?: string; }) {
    const page = Math.max(params.page || 1, 1);
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const where: any = {
      status: 'PUBLISHED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(params.category ? { category: params.category } : {}),
      ...(params.subCategory ? { subCategory: params.subCategory } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.marketplaceAd.count({ where }),
      this.prisma.marketplaceAd.findMany({
        where,
        orderBy: [
          { featuredUntil: 'desc' },
          { homepageSpotlight: 'desc' },
          { featuredPlacement: 'desc' },
          { publishedAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
    ]);

    return { page, limit, total, items };
  }

  async getPublicAd(id: string) {
    const now = new Date();
    const found = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!found || found.status !== 'PUBLISHED') {
      throw new NotFoundException('Ad not found');
    }
    if (found.expiresAt && found.expiresAt <= now) {
      throw new NotFoundException('Ad expired');
    }
    return { success: true, data: found };
  }

  async createPayment(userId: number, id: string) {
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');
    if (ad.status !== 'DRAFT') throw new BadRequestException('Only draft ads can be paid');

    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        marketplaceAdId: id,
        paymentType: 'MARKETPLACE_AD',
        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPayment?.status === 'COMPLETED') {
      return {
        success: true,
        message: 'Payment already completed. Ad is awaiting admin approval.',
        paymentId: existingPayment.id,
      };
    }

    if (existingPayment) {
      return {
        success: true,
        message: 'Payment already initiated. Please complete the pending transaction.',
        paymentId: existingPayment.id,
      };
    }

    const tier = ad.tier ?? 'FREE';
    const maxImages = this.maxImagesForTier(tier);
    if (ad.imageCount > maxImages) {
      throw new BadRequestException(`Image limit exceeded. ${tier} allows up to ${maxImages} images.`);
    }

    const pricing = await this.pricingService.getPricingMap();
    const breakdown = this.buildPricingBreakdown(ad, pricing);

    if (breakdown.missingCategoryPrice) {
      this.logger.warn(`No pricing found for category "${ad.category}". Using $0 base price.`);
    }

    if (breakdown.total <= 0) {
      const updated = await this.prisma.marketplaceAd.update({
        where: { id },
        data: {
          status: 'PENDING_APPROVAL',
          totalPrice: 0,
        },
      });
      return {
        success: true,
        data: updated,
        message: 'No payment required. Ad submitted for admin approval.',
        pricing: breakdown,
      };
    }

    await this.prisma.marketplaceAd.update({
      where: { id },
      data: { totalPrice: breakdown.total },
    });

    const payment = await this.movementPaymentService.createMarketplaceAdPayment(userId, id, breakdown.total);
    return {
      success: true,
      payment,
      pricing: breakdown,
    };
  }

  async markSold(userId: number, id: string) {
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');

    const updated = await this.prisma.marketplaceAd.update({
      where: { id },
      data: { status: 'SOLD' },
    });

    return { success: true, data: updated };
  }

  async extendAd(userId: number, id: string) {
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');

    if (ad.status !== 'PUBLISHED') {
      throw new BadRequestException('Only published ads can be extended');
    }

    const pricing = await this.pricingService.getPricingMap();
    const breakdown = this.buildPricingBreakdown(ad, pricing);

    const canFreeExtend = ad.tier === 'FREE' && (ad.extendedCount ?? 0) < this.freeExtensionLimit;
    if (!canFreeExtend) {
      return {
        success: false,
        requiresPayment: true,
        amount: breakdown.baseCategory + breakdown.tier,
        currency: 'USDC',
        message: 'Free extensions exhausted. Payment required to extend this ad.',
      };
    }

    const baseDate = ad.expiresAt && ad.expiresAt > new Date() ? ad.expiresAt : new Date();
    const nextExpiry = new Date(baseDate);
    nextExpiry.setDate(nextExpiry.getDate() + this.baseExpiryDays);

    const updated = await this.prisma.marketplaceAd.update({
      where: { id },
      data: {
        expiresAt: nextExpiry,
        extendedCount: (ad.extendedCount ?? 0) + 1,
        lastExtendedAt: new Date(),
        expiryNoticeSentAt: null,
      },
    });

    return { success: true, data: updated };
  }

  async flagExpiryNotice() {
    const now = new Date();
    const noticeDate = new Date(now);
    noticeDate.setDate(noticeDate.getDate() + 7);

    const candidates = await this.prisma.marketplaceAd.findMany({
      where: {
        status: 'PUBLISHED',
        expiresAt: { lte: noticeDate },
        expiryNoticeSentAt: null,
      },
    });

    if (!candidates.length) return { success: true, notified: 0 };

    await this.prisma.marketplaceAd.updateMany({
      where: {
        id: { in: candidates.map((ad) => ad.id) },
      },
      data: { expiryNoticeSentAt: now },
    });

    this.logger.log(`Flagged ${candidates.length} marketplace ads for expiry notice`);
    return { success: true, notified: candidates.length };
  }

  async expireAds() {
    const now = new Date();
    const expiring = await this.prisma.marketplaceAd.updateMany({
      where: {
        status: 'PUBLISHED',
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED' },
    });

    if (expiring.count > 0) {
      this.logger.log(`Expired ${expiring.count} marketplace ads`);
    }

    return { success: true, expired: expiring.count };
  }
}
