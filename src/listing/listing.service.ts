/*
  ListingService
  --------------
  Orchestrates listing queries, on-demand scans, and background refresh.
*/
import { Injectable, Logger, NotFoundException, BadRequestException, Header } from '@nestjs/common';
import { ListingRepository } from './repository/listing.repository';
import { ListingQueryDto } from './dto/listing-query.dto';
import { CacheService } from './services/cache.service';
import { RefreshWorker } from './workers/refresh.worker';
import { ScanService } from '../scan/services/scan.service';
import { MetricsService } from './services/metrics.service';
import { AnalyticsService } from './services/analytics.service';

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    private readonly repo: ListingRepository,
    private readonly cache: CacheService,
    private readonly scanService: ScanService,
    private readonly worker: RefreshWorker,
    private readonly metricsSvc: MetricsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async listListings(query: ListingQueryDto) {
    const key = this.cache.cacheKey('list', query);
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const data = await this.repo.findListings(query);
    await this.cache.set(key, data, 60);
    return data;
  }

  async getListing(contractAddress: string) {
    const key = this.cache.cacheKey('one', { contractAddress });
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const listing = await this.repo.findOne(contractAddress);
    if (!listing) throw new NotFoundException('Listing not found');

    await this.cache.set(key, listing, 60);
    return listing;
  }

  async scan(contractAddress: string, chain: 'SOLANA' | 'EVM' | 'NEAR' | 'OSMOSIS' | 'OTHER' = 'SOLANA') {
    if (!contractAddress) throw new BadRequestException('contractAddress is required');

    // Map EVM to ETHEREUM for Prisma
    const prismaChain = chain === 'EVM' ? 'ETHEREUM' : chain;

    // Guard: only Solana supported for enrichment
    if (chain !== 'SOLANA') {
      const summary = `${chain} enrichment not supported yet`;
      const { listing } = await this.repo.persistScanAndUpsertListing({
        contractAddress,
        chain: prismaChain as any,
        token: null,
        riskScore: null,
        tier: null,
        summary,
      });
      return { contractAddress, chain, riskScore: null, tier: null, summary, listing };
    }

    const result = await this.scanService.scanToken(contractAddress, undefined, chain);
    const { listing, scan } = await this.repo.persistScanAndUpsertListing({
      contractAddress,
      chain: prismaChain as any,
      token: result.metadata,
      riskScore: result.risk_score,
      tier: result.tier,
      summary: result.summary,
    });

    await this.cache.invalidateMatching(['listing:list:*', 'listing:one:*']);
    this.metricsSvc.incCounter(`listing_scan_enrichments_total{chain="${chain}"}`, 1);

    const summary = (listing as any)?.summary ?? (scan as any)?.summary ?? result.summary ?? 'Scan completed';
    return { contractAddress, chain, riskScore: result.risk_score, tier: result.tier, summary, listing };
  }

  async refresh(contractAddress: string, chain: 'SOLANA' | 'EVM' | 'NEAR' | 'OSMOSIS' | 'OTHER' = 'SOLANA') {
    if (!contractAddress) throw new BadRequestException('contractAddress is required');
    // Map EVM to ETHEREUM for worker
    const workerChain = chain === 'EVM' ? 'ETHEREUM' : chain;
    this.worker.enqueue({ address: contractAddress, chain: workerChain as any });
    return { accepted: true, contractAddress, chain };
  }

  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics() {
    return this.metricsSvc.exportPrometheus();
  }

  /**
   * Get holder count with multi-API fallback
   */
  async getHolders(contractAddress: string, chain: string) {
    const key = this.cache.cacheKey('holders', { contractAddress, chain });
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const holderCount = await this.analyticsService.getHolderCount(contractAddress, chain);
    
    const result = {
      contractAddress,
      chain,
      holders: holderCount,
      source: holderCount !== null ? 'api' : 'unavailable',
      timestamp: new Date().toISOString(),
    };

    // Cache for 5 minutes (holder count changes slowly)
    await this.cache.set(key, result, 300);
    return result;
  }

  /**
   * Get transfer analytics via Bitquery
   */
  async getTransfers(contractAddress: string, chain: string) {
    const key = this.cache.cacheKey('transfers', { contractAddress, chain });
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const transferData = await this.analyticsService.getTransferAnalytics(contractAddress, chain);
    
    const result = {
      contractAddress,
      chain,
      data: transferData,
      timestamp: new Date().toISOString(),
    };

    // Cache for 2 minutes
    await this.cache.set(key, result, 120);
    return result;
  }

  /**
   * Get OHLCV chart data
   */
  async getChartData(contractAddress: string, chain: string, timeframe: string) {
    const key = this.cache.cacheKey('chart', { contractAddress, chain, timeframe });
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const chartData = await this.analyticsService.getOHLCVData(contractAddress, chain, timeframe);
    
    const result = {
      contractAddress,
      chain,
      timeframe,
      data: chartData,
      timestamp: new Date().toISOString(),
    };

    // Cache for 1 minute
    await this.cache.set(key, result, 60);
    return result;
  }

  /**
   * Add a token to the database (manual addition)
   * Token will be processed by Pillar 1 (vetting) automatically
   */
  async addToken(contractAddress: string, chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN', symbol?: string, name?: string) {
    if (!contractAddress) throw new BadRequestException('contractAddress is required');

    // Check if token already exists
    const existing = await this.repo.findOne(contractAddress);
    if (existing) {
      throw new BadRequestException(`Token with address ${contractAddress} already exists`);
    }

    // Add token with vetted=false (will be processed by Pillar 1)
    const client = (this.repo as any)['prisma'] as any;
    const listing = await client.listing.create({
      data: {
        contractAddress,
        chain,
        symbol: symbol || null,
        name: name || null,
        vetted: false, // Will be processed by Pillar 1
        category: 'MEME', // Default, will be updated during vetting
      },
    });

    // Clear cache
    await this.cache.invalidateMatching(['listing:list:*', 'listing:one:*']);

    this.logger.log(`✅ Token added: ${contractAddress} (${chain}) - Will be processed by Pillar 1`);
    
    return {
      success: true,
      contractAddress,
      chain,
      listing,
      message: 'Token added successfully. It will be processed by Pillar 1 (vetting) within the next 10 minutes.',
    };
  }

  /**
   * Delete a token from the database
   */
  async deleteToken(contractAddress: string) {
    if (!contractAddress) throw new BadRequestException('contractAddress is required');

    const client = (this.repo as any)['prisma'] as any;
    const deleted = await client.listing.delete({
      where: { contractAddress },
    }).catch((error: any) => {
      if (error.code === 'P2025') {
        // Record not found
        throw new NotFoundException(`Token with address ${contractAddress} not found`);
      }
      throw error;
    });

    // Also delete associated scan results
    await client.scanResult.deleteMany({
      where: { contractAddress },
    }).catch(() => {
      // Ignore errors if no scan results exist
    });

    // Clear cache
    await this.cache.invalidateMatching(['listing:list:*', 'listing:one:*']);

    this.logger.log(`✅ Token deleted: ${contractAddress}`);
    
    return {
      success: true,
      contractAddress,
      message: 'Token deleted successfully',
    };
  }

  /**
   * Refresh holder data for all tokens
   */
  async refreshHolders() {
    this.logger.log('Starting holder data refresh for all tokens...');
    
    try {
      // Get all listings from database
      const client = (this.repo as any)['prisma'] as any;
      const listings = await client.listing.findMany({
        select: { contractAddress: true, chain: true, symbol: true }
      });

      let updated = 0;
      let failed = 0;

      // Process each listing
      for (const listing of listings) {
        try {
          // Fetch holder count
          const holderCount = await this.analyticsService.getHolderCount(
            listing.contractAddress, 
            listing.chain
          );

          if (holderCount !== null && holderCount > 0) {
            // Update the listing with new holder count
            await client.listing.update({
              where: { contractAddress: listing.contractAddress },
              data: { holders: holderCount }
            });
            
            this.logger.log(`✅ Updated holders for ${listing.symbol}: ${holderCount}`);
            updated++;
          } else {
            this.logger.warn(`❌ No holder data for ${listing.symbol}`);
            failed++;
          }
        } catch (error) {
          this.logger.error(`Failed to update holders for ${listing.symbol}: ${error.message}`);
          failed++;
        }
      }

      // Clear cache to force refresh
      await this.cache.invalidateMatching(['listing:list:*', 'listing:one:*']);

      return {
        success: true,
        total: listings.length,
        updated,
        failed,
        message: `Holder data refresh completed: ${updated} updated, ${failed} failed`
      };
    } catch (error) {
      this.logger.error('Holder refresh failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}