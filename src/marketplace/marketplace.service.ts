import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MovementPaymentService } from '../payment/movement-payment.service';
import { SolanaPaymentService } from '../payment/solana-payment.service';
import { MarketplacePricingService } from './marketplace-pricing.service';
import { XpService } from '../xp/xp.service';
import { EmailService } from '../email/email.service';
import { CreateMarketplaceAdDto } from './dto/create-marketplace-ad.dto';
import { UpdateMarketplaceAdDto } from './dto/update-marketplace-ad.dto';

type PricingBreakdown = {
  baseCategory: number;
  tier: number;
  addOns: number;
  total: number;
  missingCategoryPrice: boolean;
};

type MarketplaceAdDurationMode = 'SINGULAR' | 'RECURRING';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);
  private readonly baseExpiryDays = 28;
  private readonly expiredRetentionDays = 90;
  private readonly freeExtensionLimit = 3;
  private readonly adUserSelect = {
    id: true,
    email: true,
    name: true,
    avatarUrl: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movementPaymentService: MovementPaymentService,
    private readonly solanaPaymentService: SolanaPaymentService,
    private readonly pricingService: MarketplacePricingService,
    private readonly xpService: XpService,
    private readonly emailService: EmailService,
  ) {}

  private async resolveUserId(userIdOrSub: unknown, email?: string | null) {
    const numericId = Number(userIdOrSub);
    if (Number.isFinite(numericId) && numericId > 0) {
      return numericId;
    }

    if (email) {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (user?.id) return user.id;
    }

    throw new ForbiddenException('Authentication required');
  }

  private normalizeImages(images?: string[]) {
    if (!images) return [];
    return images.filter(Boolean);
  }

  private normalizeDurationMode(mode?: string | null): MarketplaceAdDurationMode {
    return String(mode || 'SINGULAR').toUpperCase() === 'RECURRING' ? 'RECURRING' : 'SINGULAR';
  }

  private isRecurringAd(ad: { durationMode?: string | null }) {
    return this.normalizeDurationMode(ad.durationMode) === 'RECURRING';
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

  async createDraft(userIdOrSub: unknown, dto: CreateMarketplaceAdDto, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);

    const tier = dto.tier || 'FREE';
    const durationMode = this.normalizeDurationMode(dto.durationMode);
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
        durationMode: durationMode as any,
        featuredPlacement: dto.featuredPlacement ?? false,
        homepageSpotlight: dto.homepageSpotlight ?? false,
        topOfDayDays: dto.topOfDayDays ?? null,
        autoBumpDays: dto.autoBumpDays ?? null,
        urgentTag: dto.urgentTag ?? false,
        multiChainTag: dto.multiChainTag ?? false,
        status: 'DRAFT',
      },
      include: {
        user: {
          select: this.adUserSelect,
        },
      },
    });
    return { success: true, data: created };
  }

  async updateDraft(userIdOrSub: unknown, id: string, dto: UpdateMarketplaceAdDto, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);
    const found = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Ad not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your ad');
    if (['PUBLISHED', 'EXPIRED', 'SOLD'].includes(found.status)) {
      throw new BadRequestException('Cannot modify a published or expired ad');
    }

    const tier = (dto.tier ?? found.tier) as string;
    const durationMode = this.normalizeDurationMode((dto.durationMode ?? (found as any).durationMode) as string);
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
        durationMode: durationMode as any,
        featuredPlacement: dto.featuredPlacement ?? found.featuredPlacement,
        homepageSpotlight: dto.homepageSpotlight ?? found.homepageSpotlight,
        topOfDayDays: dto.topOfDayDays ?? found.topOfDayDays,
        autoBumpDays: dto.autoBumpDays ?? found.autoBumpDays,
        urgentTag: dto.urgentTag ?? found.urgentTag,
        multiChainTag: dto.multiChainTag ?? found.multiChainTag,
      },
      include: {
        user: {
          select: this.adUserSelect,
        },
      },
    });

    return { success: true, data: updated };
  }

  async listMine(userIdOrSub: unknown, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);
    const items = await this.prisma.marketplaceAd.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: this.adUserSelect,
        },
      },
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
        include: {
          user: {
            select: this.adUserSelect,
          },
        },
      }),
    ]);

    return { page, limit, total, items };
  }

  async listTrending(params: { page?: number; limit?: number }) {
    const page = Math.max(params.page || 1, 1);
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const where: any = {
      status: 'PUBLISHED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.marketplaceAd.count({ where }),
      this.prisma.marketplaceAd.findMany({
        where,
        orderBy: [
          { lastInteractionAt: 'desc' },
          { messageCount: 'desc' },
          { viewCount: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          user: {
            select: this.adUserSelect,
          },
        },
      }),
    ]);

    return { page, limit, total, items };
  }

  async listForYou(userId: number, params: { page?: number; limit?: number }) {
    const page = Math.max(params.page || 1, 1);
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const skip = (page - 1) * limit;
    const now = new Date();

    const recentInteractions = await this.prisma.marketplaceAdInteraction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { ad: true },
    });

    const categories = Array.from(
      new Set(recentInteractions.map((i) => i.ad?.category).filter(Boolean))
    ) as string[];

    if (!categories.length) {
      return this.listPublic({ page, limit });
    }

    const where: any = {
      status: 'PUBLISHED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(categories.length ? { category: { in: categories } } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.marketplaceAd.count({ where }),
      this.prisma.marketplaceAd.findMany({
        where,
        orderBy: [
          { lastInteractionAt: 'desc' },
          { publishedAt: 'desc' },
        ],
        skip,
        take: limit,
        include: {
          user: {
            select: this.adUserSelect,
          },
        },
      }),
    ]);

    return { page, limit, total, items };
  }

  async recordInteraction(adId: string, type: 'VIEW' | 'APPLY' | 'MESSAGE' | 'SHARE', userId?: number) {
    await this.prisma.marketplaceAdInteraction.create({
      data: { adId, userId: userId ?? null, type },
    });

    const updateData: any = {
      lastInteractionAt: new Date(),
    };
    if (type === 'VIEW') updateData.viewCount = { increment: 1 };
    if (type === 'MESSAGE' || type === 'APPLY') updateData.messageCount = { increment: 1 };

    await this.prisma.marketplaceAd.update({
      where: { id: adId },
      data: updateData,
    });

    if (type === 'SHARE' && userId) {
      await this.xpService.awardShareAd(userId, adId);
    }
  }

  async getPublicAd(id: string) {
    const now = new Date();
    const found = await this.prisma.marketplaceAd.findUnique({
      where: { id },
      include: {
        user: {
          select: this.adUserSelect,
        },
      },
    });
    if (!found || found.status !== 'PUBLISHED') {
      throw new NotFoundException('Ad not found');
    }
    if (found.expiresAt && found.expiresAt <= now) {
      throw new NotFoundException('Ad expired');
    }
    return { success: true, data: found };
  }

  async createPayment(
    userIdOrSub: unknown,
    id: string,
    email?: string | null,
    paymentChain?: 'MOVEMENT' | 'SOLANA' | string,
  ) {
    const userId = await this.resolveUserId(userIdOrSub, email);
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
      const metadata = (existingPayment.metadata || {}) as any;
      const chain = String(metadata?.chain || '').toUpperCase();
      if (chain === 'MOVEMENT') {
        const amountInNativeUnits =
          String(metadata?.amountInNativeUnits || Math.round(Number(existingPayment.amount || 0) * 1e6));
        const tokenAddress = String(metadata?.tokenAddress || '');
        const toWallet = String(metadata?.toWallet || existingPayment.toAddress || '');

        return {
          success: true,
          message: 'Payment already initiated. Please complete the pending transaction.',
          paymentId: existingPayment.id,
          payment: {
            id: existingPayment.id,
            paymentId: existingPayment.id,
            chain: 'movement',
            amountDisplay: Number(existingPayment.amount || 0),
            tokenSymbol: 'USDC.e',
            transactionData: {
              type: 'entry_function_payload',
              function: '0x1::primary_fungible_store::transfer',
              type_arguments: ['0x1::fungible_asset::Metadata'],
              arguments: [tokenAddress, toWallet, amountInNativeUnits],
            },
          },
        };
      }

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
        include: {
          user: { select: { email: true, name: true } },
        },
      });
      if (updated.user?.email) {
        await this.emailService.sendMarketplaceAdPendingEmail({
          to: updated.user.email,
          userName: updated.user.name,
          adId: updated.id,
          adTitle: updated.title,
        });
      }
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

    const requestedPaymentChain = (paymentChain || '').toString().toUpperCase();
    const chain =
      requestedPaymentChain === 'SOLANA' || requestedPaymentChain === 'MOVEMENT'
        ? requestedPaymentChain
        : (ad.chain || 'MOVEMENT').toString().toUpperCase();
    const payment =
      chain === 'SOLANA'
        ? await this.solanaPaymentService.createMarketplaceAdPayment(userId, id, breakdown.total)
        : await this.movementPaymentService.createMarketplaceAdPayment(userId, id, breakdown.total);
    return {
      success: true,
      payment,
      pricing: breakdown,
    };
  }

  async verifyPayment(paymentId: string, txHash: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    const chain = (payment.metadata as any)?.chain || (payment as any)?.chain || '';
    if (String(chain).toUpperCase() === 'SOLANA') {
      return this.solanaPaymentService.verifyMarketplaceAdPayment(paymentId, txHash);
    }
    return this.movementPaymentService.verifyMarketplaceAdPayment(paymentId, txHash);
  }

  async markSold(userIdOrSub: unknown, id: string, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');

    const updated = await this.prisma.marketplaceAd.update({
      where: { id },
      data: { status: 'SOLD' },
    });

    return { success: true, data: updated };
  }

  async closeAd(userIdOrSub: unknown, id: string, email?: string | null) {
    return this.markSold(userIdOrSub, id, email);
  }

  async repostAd(userIdOrSub: unknown, id: string, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');
    if (ad.status !== 'EXPIRED') {
      throw new BadRequestException('Only expired ads can be reposted');
    }

    if (ad.expiresAt) {
      const retentionCutoff = new Date();
      retentionCutoff.setDate(retentionCutoff.getDate() - this.expiredRetentionDays);
      if (ad.expiresAt <= retentionCutoff) {
        throw new BadRequestException('This ad expired more than 90 days ago and cannot be reposted');
      }
    }

    const reposted = await this.prisma.marketplaceAd.update({
      where: { id },
      data: {
        status: 'DRAFT',
        publishedAt: null,
        expiresAt: null,
        extendedCount: 0,
        lastExtendedAt: null,
        expiryNoticeSentAt: null,
        featuredUntil: null,
      },
    });

    return {
      success: true,
      message: 'Ad moved back to draft. Complete payment to repost.',
      data: reposted,
    };
  }

  async extendAd(userIdOrSub: unknown, id: string, email?: string | null) {
    const userId = await this.resolveUserId(userIdOrSub, email);
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your ad');

    if (this.isRecurringAd(ad)) {
      return {
        success: true,
        data: ad,
        message: 'Recurring ads stay open until you close them manually.',
      };
    }

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
        durationMode: 'SINGULAR',
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
        durationMode: 'SINGULAR',
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED' },
    });

    if (expiring.count > 0) {
      this.logger.log(`Expired ${expiring.count} marketplace ads`);
    }

    return { success: true, expired: expiring.count };
  }

  async purgeExpiredAds() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.expiredRetentionDays);

    const result = await this.prisma.marketplaceAd.deleteMany({
      where: {
        status: 'EXPIRED',
        expiresAt: { lte: cutoff },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Permanently deleted ${result.count} expired marketplace ads older than ${this.expiredRetentionDays} days`);
    }

    return { success: true, deleted: result.count };
  }
}
