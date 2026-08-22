import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FavoriteTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';

type NormalizedFavoriteTarget = {
  targetId: string;
  targetKey: string;
  chain: string | null;
};

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number, targetType?: FavoriteTargetType) {
    const items = await this.prisma.favorite.findMany({
      where: {
        userId,
        ...(targetType ? { targetType } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, items, total: items.length };
  }

  async add(userId: number, dto: CreateFavoriteDto) {
    const target = await this.normalizeAndVerifyTarget(dto);
    const favorite = await this.prisma.favorite.upsert({
      where: {
        userId_targetType_targetKey: {
          userId,
          targetType: dto.targetType,
          targetKey: target.targetKey,
        },
      },
      create: {
        userId,
        targetType: dto.targetType,
        ...target,
      },
      update: {
        targetId: target.targetId,
        chain: target.chain,
      },
    });

    return { success: true, favorite };
  }

  async remove(userId: number, favoriteId: string) {
    const favorite = await this.prisma.favorite.findFirst({
      where: { id: favoriteId, userId },
      select: { id: true },
    });
    if (!favorite) throw new NotFoundException('Favorite not found');

    await this.prisma.favorite.delete({ where: { id: favorite.id } });
    return { success: true, deletedId: favorite.id };
  }

  private async normalizeAndVerifyTarget(dto: CreateFavoriteDto): Promise<NormalizedFavoriteTarget> {
    const rawTargetId = dto.targetId?.trim();
    if (!rawTargetId) throw new BadRequestException('Favorite target is required');

    if (dto.targetType === FavoriteTargetType.USER_LISTING) {
      const listing = await this.prisma.userListing.findFirst({
        where: { id: rawTargetId, status: 'PUBLISHED' },
        select: { id: true, chain: true },
      });
      if (!listing) throw new NotFoundException('Published user listing not found');
      const chain = this.normalizeChain(listing.chain);
      return { targetId: listing.id, targetKey: listing.id, chain };
    }

    if (dto.targetType === FavoriteTargetType.MARKETPLACE_AD) {
      const ad = await this.prisma.marketplaceAd.findFirst({
        where: { id: rawTargetId, status: 'PUBLISHED' },
        select: { id: true, chain: true },
      });
      if (!ad) throw new NotFoundException('Published marketplace ad not found');
      const chain = ad.chain ? this.normalizeChain(String(ad.chain)) : null;
      return { targetId: ad.id, targetKey: ad.id, chain };
    }

    const requestedChain = dto.chain ? this.normalizeChain(dto.chain) : null;
    const token = await this.prisma.listing.findFirst({
      where: {
        contractAddress: rawTargetId,
        ...(requestedChain ? { chain: requestedChain as any } : {}),
      },
      select: { contractAddress: true, chain: true },
    });
    const userListing = token
      ? null
      : await this.prisma.userListing.findFirst({
          where: {
            contractAddr: rawTargetId,
            status: 'PUBLISHED',
            ...(requestedChain ? { chain: requestedChain } : {}),
          },
          select: { contractAddr: true, chain: true },
        });

    if (!token && !userListing) throw new NotFoundException('Published token listing not found');

    const resolvedChain = this.normalizeChain(String(token?.chain || userListing?.chain || requestedChain || 'UNKNOWN'));
    const targetId = token?.contractAddress || userListing!.contractAddr;
    const normalizedAddress = this.isCaseInsensitiveChain(resolvedChain)
      ? targetId.toLowerCase()
      : targetId;

    return {
      targetId,
      targetKey: `${resolvedChain}:${normalizedAddress}`,
      chain: resolvedChain,
    };
  }

  private normalizeChain(chain: string): string {
    return chain.trim().toUpperCase();
  }

  private isCaseInsensitiveChain(chain: string): boolean {
    return ['ETHEREUM', 'BASE', 'BSC', 'MOVEMENT', 'APTOS'].includes(chain);
  }
}
