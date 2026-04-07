import { Injectable, ForbiddenException, NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserListingDto } from './dto/create-user-listing.dto';
import { UpdateUserListingDto } from './dto/update-user-listing.dto';
import { CreateAdBoostDto } from './dto/ad-boost.dto';
import { ScanDto } from './dto/scan.dto';
import { ScanService } from '../scan/services/scan.service';
import { XpService } from '../xp/xp.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class UserListingsService {
  private defaultMinQualifyingScore = 50;
  private aptosMinQualifyingScore = 50;

  constructor(
    private prisma: PrismaService,
    private scanService: ScanService,
    private xpService: XpService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {
    const defaultMin = Number(this.configService.get('MIN_QUALIFYING_SCORE') ?? 50);
    const aptosMin = Number(this.configService.get('APTOS_MIN_QUALIFYING_SCORE') ?? defaultMin);
    this.defaultMinQualifyingScore = Number.isFinite(defaultMin) ? defaultMin : 50;
    this.aptosMinQualifyingScore = Number.isFinite(aptosMin) ? aptosMin : this.defaultMinQualifyingScore;
  }

  private getMinQualifyingScore(chain?: string): number {
    return (chain || '').toUpperCase() === 'APTOS'
      ? this.aptosMinQualifyingScore
      : this.defaultMinQualifyingScore;
  }

  private async getLatestScan(contractAddress: string) {
    if (!contractAddress) return null;
    return (this.prisma as any).scanResult.findFirst({
      where: { contractAddress },
      orderBy: { createdAt: 'desc' },
    });
  }

  private enrichWithScan<T extends { contractAddr: string }>(item: T, scan: any) {
    const scanData = scan?.resultData ?? null;
    const metadata = scanData?.metadata ?? scanData ?? null;

    return {
      ...item,
      scanMetadata: metadata,
      scanSummary: scan?.summary ?? scanData?.summary ?? null,
      scanRiskScore: scan?.riskScore ?? scanData?.risk_score ?? null,
      scanTier: scan?.tier ?? scanData?.tier ?? null,
    };
  }

  private buildProvisionalInfo(reasonCode: string | null, metadata: any, tier?: string | null) {
    const missingData = Array.isArray(metadata?.vetting_results?.missingData)
      ? metadata.vetting_results.missingData
      : [];
    const provisional =
      reasonCode === 'INSUFFICIENT_MARKET_DATA' || reasonCode === 'PARTIAL_MARKET_DATA';
    const tierLabel = tier || 'UNQUALIFIED';
    const provisionalReason = provisional
      ? missingData.length > 0
        ? `${tierLabel} is provisional due to missing data: ${missingData.join(', ')}.`
        : 'Provisional tier due to incomplete market data.'
      : null;

    return {
      provisional,
      provisional_reason: provisionalReason,
      provisional_missing_data: provisional ? missingData : [],
    };
  }

  async scan(userId: number | undefined, dto: ScanDto) {
    const chain = dto.chain || 'SOLANA';
    const minQualifyingScore = this.getMinQualifyingScore(chain);
    try {
      const now = Date.now();
      const cacheWindowMs = 24 * 60 * 60 * 1000;
      const shouldUseCache = chain !== 'APTOS';
      const recentScan = shouldUseCache
        ? await (this.prisma as any).scanResult.findFirst({
            where: {
              contractAddress: dto.contractAddr,
              createdAt: { gte: new Date(now - cacheWindowMs) },
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;

      if (recentScan?.resultData) {
        const stored = recentScan.resultData as any;
        const riskScore = stored?.risk_score ?? recentScan.riskScore ?? 0;
        const tier = stored?.tier ?? recentScan.tier ?? 'Seed';
        const eligible =
          stored?.eligible ??
          (typeof riskScore === 'number' &&
            riskScore >= minQualifyingScore);

        const metadata = stored?.metadata ?? stored;
        const summary = stored?.summary ?? recentScan.summary ?? null;
        const riskLevel = stored?.risk_level ?? null;
        const reasonCode = stored?.reason_code ?? metadata?.reason_code ?? null;
        const provisionalInfo = this.buildProvisionalInfo(reasonCode, metadata, tier);

        return {
          success: eligible,
          risk_score: riskScore,
          tier,
          risk_level: riskLevel,
          reason_code: reasonCode,
          minimum_required_score: minQualifyingScore,
          ...provisionalInfo,
          eligible,
          summary,
          metadata,
          vettingScore: riskScore,
          vettingTier: tier,
          details: stored,
        };
      }

      // Delegate to existing ScanService; use userId to persist scan result linkage
      const result = await this.scanService.scanToken(dto.contractAddr, userId, chain as any);

      const score = result?.risk_score ?? 0; // higher is better (score range: 0-100, higher = safer)
      const tier = result?.tier ?? 'Seed';
      const metadata = result?.metadata ?? null;
      const summary = result?.summary ?? null;
      const riskLevel = result?.risk_level ?? null;
      const reasonCode = (result as any)?.reason_code ?? (metadata as any)?.reason_code ?? null;
      const provisionalInfo = this.buildProvisionalInfo(reasonCode, metadata, tier);

      const passed = typeof score === 'number' && score >= minQualifyingScore && result?.eligible !== false;
      return {
        success: passed,
        risk_score: score, // Added for frontend compatibility
        tier: tier,       // Added for frontend compatibility
        risk_level: riskLevel,
        reason_code: reasonCode,
        minimum_required_score: minQualifyingScore,
        ...provisionalInfo,
        vettingScore: score,
        vettingTier: tier,
        eligible: passed,
        summary,
        metadata,
        details: result,
      };
    } catch (error: any) {
      // Extract risk score from HttpException response if available
      if (error instanceof HttpException && error.getResponse) {
        const response = error.getResponse() as any;
        if (response?.risk_score !== undefined) {
          const score = response.risk_score ?? 0;
          const tier = response.tier ?? 'UNQUALIFIED';
          const metadata = response.metadata ?? null;
          const reasonCode = response.reason_code ?? metadata?.reason_code ?? null;
          const provisionalInfo = this.buildProvisionalInfo(reasonCode, metadata, tier);
          return {
            success: false,
            risk_score: score,
            tier,
            risk_level: response.risk_level ?? null,
            reason_code: reasonCode,
            minimum_required_score: minQualifyingScore,
            ...provisionalInfo,
            vettingScore: score,
            vettingTier: tier,
            eligible: response.eligible ?? false,
            summary: response.summary ?? null,
            metadata,
            details: response,
          };
        }
      }
      // If we can't extract score, rethrow the error
      throw error;
    }
  }

  async create(userId: number, dto: CreateUserListingDto) {
    if (!userId) throw new ForbiddenException('Authentication required');
    // Validate that vetting score meets minimum requirement (>= 50)
    const minQualifyingScore = this.getMinQualifyingScore(dto.chain);
    const vettingScore = dto.vettingScore ?? 0;
    if (vettingScore < minQualifyingScore) {
      throw new BadRequestException(`Token does not meet minimum risk score requirement. Score: ${vettingScore}, Minimum required: ${minQualifyingScore}`);
    }

    const created = await this.prisma.userListing.create({
      data: {
        userId,
        contractAddr: dto.contractAddr,
        chain: dto.chain,
        title: dto.title,
        description: dto.description,
        bio: dto.bio,
        logoUrl: dto.logoUrl,
        bannerUrl: dto.bannerUrl,
        links: dto.links as any,
        status: 'DRAFT',
        vettingTier: dto.vettingTier,
        vettingScore: dto.vettingScore,
      },
    });
    return { success: true, data: created };
  }

  async update(userId: number, id: string, dto: UpdateUserListingDto) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');
    if (found.status === 'PUBLISHED') throw new BadRequestException('Cannot modify a published listing');

    const updated = await this.prisma.userListing.update({
      where: { id },
      data: {
        title: dto.title ?? found.title,
        description: dto.description ?? found.description,
        bio: dto.bio ?? found.bio ?? null,
        logoUrl: dto.logoUrl ?? found.logoUrl ?? null,
        bannerUrl: dto.bannerUrl ?? found.bannerUrl ?? null,
        links: (dto.links as any) ?? (found.links as any) ?? null,
        vettingTier: dto.vettingTier ?? found.vettingTier,
        vettingScore: dto.vettingScore ?? found.vettingScore,
      },
    });
    return { success: true, data: updated };
  }

  async publish(userId: number, id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');

    // minimal validation before publish
    if (!found.title || !found.description) throw new BadRequestException('Missing required fields');
    // Validate that vetting score still meets minimum requirement (>= 50)
    const minQualifyingScore = this.getMinQualifyingScore(found.chain);
    const vettingScore = found.vettingScore ?? 0;
    if (vettingScore < minQualifyingScore) {
      throw new BadRequestException(`Token does not meet minimum risk score requirement. Score: ${vettingScore}, Minimum required: ${minQualifyingScore}`);
    }

    // ⚠️ CRITICAL: Check if payment has been made before publishing
    const payment = await this.prisma.payment.findFirst({
      where: {
        userId: found.userId,
        listingId: id,
        paymentType: 'LISTING',
        status: 'COMPLETED'
      }
    });

    if (!payment) {
      throw new BadRequestException('Payment required. Please pay 1.0 USDC to publish this listing.');
    }

    // After payment, listing goes to PENDING_APPROVAL (not PUBLISHED)
    // Admin must approve before it goes live
    const updated = await this.prisma.userListing.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    const listingOwner = await this.prisma.user.findUnique({
      where: { id: found.userId },
      select: { email: true, name: true },
    });

    if (listingOwner?.email) {
      await this.emailService.sendListingPendingEmail({
        to: listingOwner.email,
        userName: listingOwner.name,
        listingId: updated.id,
        projectTitle: updated.title,
      });
    }

    return { 
      success: true, 
      data: updated,
      message: 'Payment confirmed! Listing submitted for admin approval.'
    };
  }

  async findMine(userId: number) {
    if (!userId) throw new ForbiddenException('Authentication required');
    const items = await this.prisma.userListing.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!items.length) return { success: true, items };

    const contractAddresses = items.map((item) => item.contractAddr);
    const scanResults = await (this.prisma as any).scanResult.findMany({
      where: { contractAddress: { in: contractAddresses } },
      orderBy: { createdAt: 'desc' },
    });

    const scanMap = new Map<string, any>();
    scanResults.forEach((scan: any) => {
      if (!scanMap.has(scan.contractAddress)) {
        scanMap.set(scan.contractAddress, scan);
      }
    });

    const enriched = items.map((item) => {
      const scan = scanMap.get(item.contractAddr);
      const scanData = scan?.resultData ?? null;
      const metadata = scanData?.metadata ?? scanData ?? null;

      return {
        ...item,
        scanMetadata: metadata,
        scanSummary: scan?.summary ?? scanData?.summary ?? null,
        scanRiskScore: scan?.riskScore ?? scanData?.risk_score ?? null,
        scanTier: scan?.tier ?? scanData?.tier ?? null,
      };
    });

    return { success: true, items: enriched };
  }

  async findPublic(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.userListing.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.userListing.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    if (!items.length) return { page, limit, total, items };

    const contractAddresses = items.map((item) => item.contractAddr);
    const scanResults = await (this.prisma as any).scanResult.findMany({
      where: { contractAddress: { in: contractAddresses } },
      orderBy: { createdAt: 'desc' },
    });

    const scanMap = new Map<string, any>();
    scanResults.forEach((scan: any) => {
      if (!scanMap.has(scan.contractAddress)) {
        scanMap.set(scan.contractAddress, scan);
      }
    });

    const enriched = items.map((item) => {
      const scan = scanMap.get(item.contractAddr);
      return this.enrichWithScan(item, scan);
    });

    return { page, limit, total, items: enriched };
  }

  async findOnePublic(id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found || found.status !== 'PUBLISHED') throw new NotFoundException('Listing not found');
    const scan = await this.getLatestScan(found.contractAddr);
    return { success: true, data: this.enrichWithScan(found, scan) };
  }

  async findMyListing(userId: number, id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');
    const scan = await this.getLatestScan(found.contractAddr);
    return { success: true, data: this.enrichWithScan(found, scan) };
  }

  async addAdBoost(userId: number, id: string, dto: CreateAdBoostDto) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + dto.durationDays);

    const created = await this.prisma.adBoost.create({
      data: {
        listingId: id,
        type: dto.type,
        durationDays: dto.durationDays,
        startDate,
        endDate,
      },
    });

    return { success: true, data: created };
  }

  async deleteListing(userId: number, id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');

    // Only allow deleting DRAFT listings (not paid or approved ones)
    if (found.status === 'PUBLISHED') {
      throw new BadRequestException('Cannot delete published listings. Contact admin for removal.');
    }
    
    if (found.status === 'PENDING_APPROVAL') {
      throw new BadRequestException('Cannot delete listings pending approval. Please wait for admin review or contact support.');
    }

    // Delete the listing
    await this.prisma.userListing.delete({ where: { id } });
    
    return { 
      success: true, 
      message: 'Listing deleted successfully',
      deletedId: id 
    };
  }
}
