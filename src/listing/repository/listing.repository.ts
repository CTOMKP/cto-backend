import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingQueryDto } from '../dto/listing-query.dto';
import { Chain } from '@prisma/client';

@Injectable()
export class ListingRepository {
  private readonly logger = new Logger(ListingRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findListings(query: ListingQueryDto) {
    const { q, chain, category, tier, minRisk, maxRisk, minLpBurned, maxTop10Holders, mintAuthDisabled, noRaiding, sort = 'updatedAt:desc', page = 1, limit = 20 } = query as any;

    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { symbol: { contains: q, mode: 'insensitive' } },
        { contractAddress: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (chain) where.chain = chain;
    if (category) where.category = category;
    if (tier) where.tier = tier;
    if (minRisk !== undefined || maxRisk !== undefined) {
      where.riskScore = {};
      if (minRisk !== undefined) where.riskScore.gte = Number(minRisk);
      if (maxRisk !== undefined) where.riskScore.lte = Number(maxRisk);
    }
    
    // New filter logic
    if (minLpBurned !== undefined) {
      where.lpBurnedPercentage = { gte: Number(minLpBurned) };
    }
    if (maxTop10Holders !== undefined) {
      where.top10HoldersPercentage = { lte: Number(maxTop10Holders) };
    }
    if (mintAuthDisabled !== undefined) {
      where.mintAuthDisabled = Boolean(mintAuthDisabled);
    }
    if (noRaiding !== undefined) {
      where.raidingDetected = !Boolean(noRaiding); // noRaiding=true means raidingDetected=false
    }

    const [sortField, sortDir] = String(sort).split(':');
    const orderBy: any = { [sortField || 'updatedAt']: sortDir === 'asc' ? 'asc' : 'desc' };

    const skip = Math.max(0, (Number(page || 1) - 1) * Number(limit || 20));
    const take = Math.max(1, Math.min(100, Number(limit || 20)));

    const client = this.prisma as any;
    const [items, total] = await this.prisma.$transaction([
      client.listing.findMany({ where, orderBy, skip, take }),
      client.listing.count({ where }),
    ]);

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const parseAgeToHours = (age: string | null | undefined): number => {
      if (!age || typeof age !== 'string') return 0;
      // Examples: "2d", "12h", "30m", "1d 3h"
      let hours = 0;
      const dayMatch = age.match(/(\d+)\s*d/i);
      const hourMatch = age.match(/(\d+)\s*h/i);
      const minMatch = age.match(/(\d+)\s*m/i);
      if (dayMatch) hours += Number(dayMatch[1]) * 24;
      if (hourMatch) hours += Number(hourMatch[1]);
      if (minMatch) hours += Number(minMatch[1]) / 60;
      return hours;
    };

    // NOTE: Community score is now based on user votes, not automatic calculation
    // The automatic calculation has been removed. Community score will be set by the voting system.
    // For now, we preserve existing community scores from the database, but don't compute new ones.

    // Fallback to metadata.market fields when top-level values are null
    // Community score is preserved from database (user votes) or set to null
    const enriched = items.map((i: any) => {
      const m = (i?.metadata as any)?.market ?? {};
      const t = (i?.metadata as any)?.token ?? {};
      const tx1h = (m?.txns?.h1?.buys ?? 0) + (m?.txns?.h1?.sells ?? 0);
      const tx24h = (m?.txns?.h24?.buys ?? 0) + (m?.txns?.h24?.sells ?? 0);
      
      // Normalize tier to lowercase for consistency (old scan service returns "Seed", new returns "seed")
      const rawTier = i?.tier;
      const normalizedTier = rawTier ? String(rawTier).trim().toLowerCase() : null;
      
      const merged: any = {
        ...i,
        priceUsd: i?.priceUsd ?? m?.priceUsd ?? null,
        liquidityUsd: i?.liquidityUsd ?? m?.liquidityUsd ?? null,
        volume24h: i?.volume24h ?? m?.volume?.h24 ?? m?.volume24h ?? null,
        txCount1h: i?.txCount1h ?? (tx1h || null),
        txCount24h: i?.txCount24h ?? (tx24h || null),
        change1h: i?.change1h ?? m?.priceChange?.h1 ?? null,
        change6h: i?.change6h ?? m?.priceChange?.h6 ?? null,
        change24h: i?.change24h ?? m?.priceChange?.h24 ?? null,
        marketCap: i?.marketCap ?? m?.fdv ?? m?.marketCap ?? null,
        holders: i?.holders ?? m?.holders ?? t?.holder_count ?? null,
        age: i?.age ?? t?.age_display_short ?? t?.age_display ?? null,
        // Community score is based on user votes - preserve existing value or set to null
        communityScore: i?.communityScore ?? null,
        // Tier: normalize to lowercase for frontend consistency
        tier: normalizedTier,
        logoUrl: (i as any)?.logoUrl ?? m?.logoUrl ?? null,
      };
      // No automatic calculation - community score comes from user votes
      return merged;
    });

    return { page: Number(page || 1), limit: Number(limit || 20), total, items: enriched };
  }

  async findOne(contractAddress: string) {
    const client = this.prisma as any;
    return client.listing.findUnique({ where: { contractAddress } });
  }

  async upsertMarketMetadata(params: { contractAddress: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN'; symbol?: string | null; name?: string | null; market?: any }) {
    const { contractAddress, chain, symbol = null, name = null, market } = params;
    const category = market?.category ?? 'MEME';

    // Map nested market fields to top-level columns for fast queries and UI rendering
    const priceUsd = market?.priceUsd ?? null;
    const liquidityUsd = market?.liquidityUsd ?? null;
    const volume24h = market?.volume?.h24 ?? market?.volume24h ?? null;
    const txCount1h = ((market?.txns?.h1?.buys ?? 0) + (market?.txns?.h1?.sells ?? 0)) || null;
    const txCount24h = ((market?.txns?.h24?.buys ?? 0) + (market?.txns?.h24?.sells ?? 0)) || null;
    const change1h = market?.priceChange?.h1 ?? null;
    const change6h = market?.priceChange?.h6 ?? null;
    const change24h = market?.priceChange?.h24 ?? null;
    const marketCap = market?.fdv ?? market?.marketCap ?? null;
    const holders = market?.holders ?? null;

    // Debug logging for holders data
    if (holders !== null) {
      console.log(`👥 Holders data found for ${symbol || contractAddress}: ${holders}`);
    }

    const client = this.prisma as any;
    const existing = await client.listing.findUnique({ where: { contractAddress } });
    const prevMeta = (existing?.metadata ?? {}) as any;
    const nextMeta = { ...prevMeta, market: { ...(prevMeta.market ?? {}), ...(market ?? {}) } };

    // NOTE: Community score is now based on user votes, not automatic calculation
    // Preserve existing community score from database (set by voting system) or set to null
    const existingCommunityScore = existing?.communityScore ?? null;

    return client.listing.upsert({
      where: { contractAddress },
      create: {
        contractAddress,
        chain,
        category,
        symbol,
        name,
        priceUsd,
        change1h,
        change6h,
        change24h,
        liquidityUsd,
        marketCap,
        volume24h,
        txCount1h,
        txCount24h,
        holders,
        metadata: nextMeta,
        // Community score is based on user votes - preserve existing or set to null
        communityScore: existingCommunityScore,
      },
      update: {
        chain,
        category,
        symbol,
        name,
        priceUsd,
        change1h,
        change6h,
        change24h,
        liquidityUsd,
        marketCap,
        volume24h,
        txCount1h,
        txCount24h,
        holders,
        metadata: nextMeta,
        // Community score is based on user votes - preserve existing value
        communityScore: existingCommunityScore,
      },
    });
  }

  async persistScanAndUpsertListing(params: { contractAddress: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN'; token: any; riskScore: number | null; tier: string | null; summary?: string | null }) {
    const { contractAddress, chain, token, riskScore, tier, summary } = params;
    const symbol = token?.token_symbol ?? token?.symbol ?? null;
    const name = token?.token_name ?? token?.name ?? null;

    return this.prisma.$transaction(async (tx) => {
      let scan: any = null;
      if (riskScore !== null && tier) {
        scan = await (tx as any).scanResult.create({
          data: {
            contractAddress,
            resultData: token,
            riskScore,
            tier,
            summary: summary ?? `Tier ${tier} · Risk ${riskScore}`,
            indexed: false,
          } as any,
        });
      }

      const existing = await (tx as any).listing.findUnique({ where: { contractAddress } });
      const prevMeta = (existing?.metadata ?? {}) as any;
      const nextMeta = { ...prevMeta, token: token ?? prevMeta.token ?? null };

      // NOTE: Community score is now based on user votes, not automatic calculation
      // Preserve existing community score from database (set by voting system) or set to null
      const existingCommunityScore = existing?.communityScore ?? null;

      // Convert 'none' tier to null for database consistency
      const tierValue = (tier === 'none' || tier === null || tier === undefined) ? null : tier;

      const listing = await (tx as any).listing.upsert({
        where: { contractAddress },
        create: {
          contractAddress,
          chain,
          symbol,
          name,
          summary: scan?.summary ?? summary ?? null,
          riskScore: riskScore ?? null,
          tier: tierValue,
          metadata: nextMeta,
          lastScannedAt: riskScore !== null ? new Date() : null,
          // Community score is based on user votes - preserve existing or set to null
          communityScore: existingCommunityScore,
        },
        update: {
          chain,
          symbol,
          name,
          summary: scan?.summary ?? summary ?? null,
          riskScore: riskScore ?? null,
          tier: tierValue,
          metadata: nextMeta,
          lastScannedAt: riskScore !== null ? new Date() : (undefined as any),
          // Community score is based on user votes - preserve existing value
          communityScore: existingCommunityScore,
        },
      });

      return { listing, scan };
    });
  }

  async updateChain(contractAddress: string, chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN') {
    return (this.prisma as any).listing.update({ where: { contractAddress }, data: { chain } });
  }

  /**
   * Save vetting results to database (matches n8n workflow format)
   */
  async saveVettingResults(params: {
    contractAddress: string;
    chain: Chain;
    name: string;
    symbol: string;
    holders: number;
    age: string;
    imageUrl: string;
    tokenAge: number;
    vettingResults: any;
    launchAnalysis: any;
    lpData: any;
    topHolders: Array<{ address: string; balance: number; percentage: number }>;
  }) {
    const {
      contractAddress,
      chain,
      name,
      symbol,
      holders,
      age,
      imageUrl,
      tokenAge,
      vettingResults,
      launchAnalysis,
      lpData,
      topHolders,
    } = params;

    const client = this.prisma as any;
    const existing = await client.listing.findUnique({ where: { contractAddress } });
    const prevMeta = (existing?.metadata ?? {}) as any;

    // Build metadata matching n8n workflow format
    const metadata = {
      ...prevMeta,
      imageUrl,
      tokenAge,
      vettingResults: {
        overallScore: vettingResults.overallScore,
        riskLevel: vettingResults.riskLevel,
        eligibleTier: vettingResults.eligibleTier,
        componentScores: {
          distribution: vettingResults.componentScores.distribution.score,
          liquidity: vettingResults.componentScores.liquidity.score,
          devAbandonment: vettingResults.componentScores.devAbandonment.score,
          technical: vettingResults.componentScores.technical.score,
        },
        flags: vettingResults.allFlags,
      },
      launchAnalysis,
      lpData,
      topHolders,
    };

    // Convert 'none' tier to null for database consistency
    const tierValue = vettingResults.eligibleTier === 'none' ? null : vettingResults.eligibleTier;

    return client.listing.upsert({
      where: { contractAddress },
      create: {
        contractAddress,
        chain,
        name,
        symbol,
        holders,
        age,
        lastScannedAt: new Date(),
        metadata,
        riskScore: vettingResults.overallScore,
        tier: tierValue,
        summary: `Risk Level: ${vettingResults.riskLevel}. ${vettingResults.allFlags[0] || 'Vetted'}`,
      },
      update: {
        name,
        symbol,
        holders,
        age,
        lastScannedAt: new Date(),
        metadata,
        riskScore: vettingResults.overallScore,
        tier: tierValue,
        summary: `Risk Level: ${vettingResults.riskLevel}. ${vettingResults.allFlags[0] || 'Vetted'}`,
      },
    });
  }
}