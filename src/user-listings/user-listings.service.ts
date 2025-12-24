import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserListingDto } from './dto/create-user-listing.dto';
import { UpdateUserListingDto } from './dto/update-user-listing.dto';
import { CreateAdBoostDto } from './dto/ad-boost.dto';
import { ScanDto } from './dto/scan.dto';
import { ScanService } from '../scan/services/scan.service';

@Injectable()
export class UserListingsService {
  private readonly MIN_QUALIFYING_SCORE = 50; // pass if risk_score >= MIN_QUALIFYING_SCORE (higher = safer, score range: 0-100)

  constructor(private prisma: PrismaService, private scanService: ScanService) {}

  async scan(userId: number | undefined, dto: ScanDto) {
    const chain = dto.chain || 'SOLANA';
    // Delegate to existing ScanService; use userId to persist scan result linkage
    const result = await this.scanService.scanToken(dto.contractAddr, userId, chain as any);

    const score = result?.risk_score ?? 0; // higher is better (score range: 0-100, higher = safer)
    const tier = result?.tier ?? 'Seed';

    const passed = typeof score === 'number' && score >= this.MIN_QUALIFYING_SCORE && result?.eligible !== false;
    return {
      success: passed,
      vettingScore: score,
      vettingTier: tier,
      eligible: passed,
      details: result,
    };
  }

  async create(userId: number, dto: CreateUserListingDto) {
    if (!userId) throw new ForbiddenException('Authentication required');
    // Validate that vetting score meets minimum requirement (>= 50)
    const vettingScore = dto.vettingScore ?? 0;
    if (vettingScore < this.MIN_QUALIFYING_SCORE) {
      throw new BadRequestException(`Token does not meet minimum risk score requirement. Score: ${vettingScore}, Minimum required: ${this.MIN_QUALIFYING_SCORE}`);
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
    const vettingScore = found.vettingScore ?? 0;
    if (vettingScore < this.MIN_QUALIFYING_SCORE) {
      throw new BadRequestException(`Token does not meet minimum risk score requirement. Score: ${vettingScore}, Minimum required: ${this.MIN_QUALIFYING_SCORE}`);
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
      throw new BadRequestException('Payment required. Please pay 50 USDC to publish this listing.');
    }

    // After payment, listing goes to PENDING_APPROVAL (not PUBLISHED)
    // Admin must approve before it goes live
    const updated = await this.prisma.userListing.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });
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
    return { success: true, items };
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
    return { page, limit, total, items };
  }

  async findOnePublic(id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found || found.status !== 'PUBLISHED') throw new NotFoundException('Listing not found');
    return { success: true, data: found };
  }

  async findMyListing(userId: number, id: string) {
    const found = await this.prisma.userListing.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Listing not found');
    if (found.userId !== userId) throw new ForbiddenException('Not your listing');
    return { success: true, data: found };
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