import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ListingQueryDto } from '../dto/listing-query.dto';

@Injectable()
export class ListingRepository {
  private readonly logger = new Logger(ListingRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findListings(query: ListingQueryDto) {
    const { q, chain, category, tier, minRisk, maxRisk, sort = 'updatedAt:desc', page = 1, limit = 20 } = query as any;

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

    const computeCommunityScore = (i: any, m: any, t: any) => {
      const holders = Number(i?.holders ?? m?.holders ?? t?.holder_count ?? 0);
      const tx1h = (m?.txns?.h1?.buys ?? 0) + (m?.txns?.h1?.sells ?? 0);
      const tx24h = (m?.txns?.h24?.buys ?? 0) + (m?.txns?.h24?.sells ?? 0);
      const change24h = Number(i?.change24h ?? m?.priceChange?.h24 ?? 0);
      const liquidity = Number(i?.liquidityUsd ?? m?.liquidityUsd ?? 0);
      const ageStr = i?.age ?? t?.age_display_short ?? t?.age_display ?? null;
      const ageHours = parseAgeToHours(ageStr);
      const risk = Number(i?.riskScore ?? 0);

      const holdersScore = clamp(holders / 1000, 0, 1) * 30;      // up to 30
      const txScore = clamp(tx24h / 1000, 0, 1) * 25;             // up to 25
      const changeScore = clamp(Math.max(0, change24h) / 100, 0, 1) * 15; // up to 15 for positive moves
      const liqScore = clamp(liquidity / 1_000_000, 0, 1) * 15;    // up to 15
      const ageScore = ageHours >= 24 ? 5 : 0;                     // small bonus for >1d
      const safetyBonus = clamp((100 - risk) / 100, 0, 1) * 10;    // up to 10 based on inverse risk

      const total = holdersScore + txScore + changeScore + liqScore + ageScore + safetyBonus;
      return Math.round(clamp(total, 0, 100) * 100) / 100; // 2 decimals
    };

    // Fallback to metadata.market fields when top-level values are null and compute communityScore
    const enriched = items.map((i: any) => {
      const m = (i?.metadata as any)?.market ?? {};
      const t = (i?.metadata as any)?.token ?? {};
      const tx1h = (m?.txns?.h1?.buys ?? 0) + (m?.txns?.h1?.sells ?? 0);
      const tx24h = (m?.txns?.h24?.buys ?? 0) + (m?.txns?.h24?.sells ?? 0);
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
        communityScore: i?.communityScore ?? null,
        logoUrl: (i as any)?.logoUrl ?? m?.logoUrl ?? null,
      };
      if (merged.communityScore === null || merged.communityScore === undefined) {
        merged.communityScore = computeCommunityScore(merged, m, t);
      }
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

    // Compute communityScore using available data (market + token metadata + existing listing fields)
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const parseAgeToHours = (age: string | null | undefined): number => {
      if (!age || typeof age !== 'string') return 0;
      let hours = 0;
      const dayMatch = age.match(/(\d+)\s*d/i);
      const hourMatch = age.match(/(\d+)\s*h/i);
      const minMatch = age.match(/(\d+)\s*m/i);
      if (dayMatch) hours += Number(dayMatch[1]) * 24;
      if (hourMatch) hours += Number(hourMatch[1]);
      if (minMatch) hours += Number(minMatch[1]) / 60;
      return hours;
    };
    const computeCommunityScore = (i: any, m: any, t: any) => {
      const holders = Number(i?.holders ?? m?.holders ?? t?.holder_count ?? 0);
      const tx24h = (m?.txns?.h24?.buys ?? 0) + (m?.txns?.h24?.sells ?? 0);
      const change24h = Number(i?.change24h ?? m?.priceChange?.h24 ?? 0);
      const liquidity = Number(i?.liquidityUsd ?? m?.liquidityUsd ?? 0);
      const ageStr = i?.age ?? t?.age_display_short ?? t?.age_display ?? null;
      const ageHours = parseAgeToHours(ageStr);
      const risk = Number(i?.riskScore ?? 0);

      const holdersScore = clamp(holders / 1000, 0, 1) * 30;
      const txScore = clamp(tx24h / 1000, 0, 1) * 25;
      const changeScore = clamp(Math.max(0, change24h) / 100, 0, 1) * 15;
      const liqScore = clamp(liquidity / 1_000_000, 0, 1) * 15;
      const ageScore = ageHours >= 24 ? 5 : 0;
      const safetyBonus = clamp((100 - risk) / 100, 0, 1) * 10;

      const total = holdersScore + txScore + changeScore + liqScore + ageScore + safetyBonus;
      return Math.round(clamp(total, 0, 100) * 100) / 100;
    };

    const m = (nextMeta as any)?.market ?? {};
    const t = (nextMeta as any)?.token ?? {};
    const computedCommunityScore = computeCommunityScore(
      {
        holders: existing?.holders ?? null,
        change24h,
        liquidityUsd,
        riskScore: existing?.riskScore ?? null,
        age: existing?.age ?? (t?.age_display_short ?? t?.age_display ?? null),
      },
      m,
      t,
    );

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
        communityScore: computedCommunityScore,
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
        communityScore: computedCommunityScore,
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

      // Recompute communityScore when riskScore/token are updated (uses existing market + new risk)
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
      const parseAgeToHours = (age: string | null | undefined): number => {
        if (!age || typeof age !== 'string') return 0;
        let hours = 0;
        const dayMatch = age.match(/(\d+)\s*d/i);
        const hourMatch = age.match(/(\d+)\s*h/i);
        const minMatch = age.match(/(\d+)\s*m/i);
        if (dayMatch) hours += Number(dayMatch[1]) * 24;
        if (hourMatch) hours += Number(hourMatch[1]);
        if (minMatch) hours += Number(minMatch[1]) / 60;
        return hours;
      };
      const computeCommunityScore = (i: any, m: any, t: any) => {
        const holders = Number(i?.holders ?? t?.holder_count ?? 0);
        const tx24h = (m?.txns?.h24?.buys ?? 0) + (m?.txns?.h24?.sells ?? 0);
        const change24h = Number(i?.change24h ?? m?.priceChange?.h24 ?? 0);
        const liquidity = Number(i?.liquidityUsd ?? m?.liquidityUsd ?? 0);
        const ageStr = i?.age ?? t?.age_display_short ?? t?.age_display ?? null;
        const ageHours = parseAgeToHours(ageStr);
        const risk = Number(i?.riskScore ?? 0);

        const holdersScore = clamp(holders / 1000, 0, 1) * 30;
        const txScore = clamp(tx24h / 1000, 0, 1) * 25;
        const changeScore = clamp(Math.max(0, change24h) / 100, 0, 1) * 15;
        const liqScore = clamp(liquidity / 1_000_000, 0, 1) * 15;
        const ageScore = ageHours >= 24 ? 5 : 0;
        const safetyBonus = clamp((100 - risk) / 100, 0, 1) * 10;

        const total = holdersScore + txScore + changeScore + liqScore + ageScore + safetyBonus;
        return Math.round(clamp(total, 0, 100) * 100) / 100;
      };

      const m = (nextMeta as any)?.market ?? {};
      const t = (nextMeta as any)?.token ?? {};
      const computedCommunityScore = computeCommunityScore(
        {
          holders: existing?.holders ?? null,
          change24h: existing?.change24h ?? null,
          liquidityUsd: existing?.liquidityUsd ?? null,
          riskScore: riskScore ?? existing?.riskScore ?? null,
          age: existing?.age ?? (t?.age_display_short ?? t?.age_display ?? null),
        },
        m,
        t,
      );

      const listing = await (tx as any).listing.upsert({
        where: { contractAddress },
        create: {
          contractAddress,
          chain,
          symbol,
          name,
          summary: scan?.summary ?? summary ?? null,
          riskScore: riskScore ?? null,
          tier: tier ?? null,
          metadata: nextMeta,
          lastScannedAt: riskScore !== null ? new Date() : null,
          communityScore: computedCommunityScore,
        },
        update: {
          chain,
          symbol,
          name,
          summary: scan?.summary ?? summary ?? null,
          riskScore: riskScore ?? null,
          tier: tier ?? null,
          metadata: nextMeta,
          lastScannedAt: riskScore !== null ? new Date() : (undefined as any),
          communityScore: computedCommunityScore,
        },
      });

      return { listing, scan };
    });
  }

  async updateChain(contractAddress: string, chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN') {
    return (this.prisma as any).listing.update({ where: { contractAddress }, data: { chain } });
  }
}