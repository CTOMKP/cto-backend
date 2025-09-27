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

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    private readonly repo: ListingRepository,
    private readonly cache: CacheService,
    private readonly scanService: ScanService,
    private readonly worker: RefreshWorker,
    private readonly metricsSvc: MetricsService,
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

    // Guard: only Solana supported for enrichment
    if (chain !== 'SOLANA') {
      const summary = `${chain} enrichment not supported yet`;
      const { listing } = await this.repo.persistScanAndUpsertListing({
        contractAddress,
        chain,
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
      chain,
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
    this.worker.enqueue({ address: contractAddress, chain });
    return { accepted: true, contractAddress, chain };
  }

  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics() {
    return this.metricsSvc.exportPrometheus();
  }
}