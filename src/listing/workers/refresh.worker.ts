import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { ScanService } from '../../scan/services/scan.service';
import { ListingRepository } from '../repository/listing.repository';
import { CacheService } from '../services/cache.service';
import { MetricsService } from '../services/metrics.service';
import { ListingGateway } from '../services/listing.gateway';
import { AnalyticsService } from '../services/analytics.service';
import { N8nService } from '../../services/n8n.service';
import { ExternalApisService } from '../../services/external-apis.service';
import { TokenImageService } from '../../services/token-image.service';
import { Pillar1RiskScoringService, TokenVettingData } from '../../services/pillar1-risk-scoring.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/*
  RefreshWorker
  -------------
  - Every 2 minutes: fetch trending/new SOL pairs from DexScreener and upsert basic market metadata.
  - Every 5 minutes: rescan known listings to enrich risk/tier/summary.
  - Non-blocking, short Redis cache (60-120s) to reduce API calls.
*/
@Injectable()
export class RefreshWorker {
  private readonly logger = new Logger(RefreshWorker.name);
  private queue: (string | { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' })[] = [];
  private running = false;
  private stats = { cycles: 0, refreshed: 0, apiCalls: 0, failures: 0, lastDurationMs: 0 };
  private readonly dexBase = process.env.DEXSCREENER_URL || 'https://api.dexscreener.com/latest';

  constructor(
    private readonly scanService: ScanService,
    private readonly repo: ListingRepository,
    private readonly cache: CacheService,
    private readonly metrics: MetricsService,
    private readonly gateway: ListingGateway,
    private readonly analyticsService: AnalyticsService,
    private readonly n8nService: N8nService,
    private readonly externalApisService: ExternalApisService,
    private readonly tokenImageService: TokenImageService,
    private readonly pillar1RiskScoringService: Pillar1RiskScoringService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  enqueue(contract: string | { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' }) {
    this.queue.push(contract as any);
    this.run();
  }

  // Cleanup old records to keep database lean (run every 6 hours)
  // This is a safety measure to ensure the DB doesn't grow too large.
  @Cron('0 */6 * * *')
  async cleanupOldRecords() {
    try {
      this.logger.log('🧹 Starting cleanup of old records...');
      
      // Use the repository's public methods instead of accessing private prisma
      const client = (this.repo as any)['prisma'] as any;
      
      // Strict limit: Keep only the latest 25 listings for the "Presentable Model"
      const listingsToKeep = await client.listing.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: { id: true }
      });
      
      const listingIds = listingsToKeep.map((l: any) => l.id);
      const deletedListings = await client.listing.deleteMany({
        where: { id: { notIn: listingIds } }
      });
      
      // Also cleanup old scans to match
      const deletedScans = await client.scanResult.deleteMany({
        where: { contractAddress: { notIn: listingsToKeep.map((l: any) => l.contractAddress) } }
      });
      
      this.logger.log(`✅ Cleanup complete: Deleted ${deletedListings.count} old listings, ${deletedScans.count} old scans`);
    } catch (error) {
      this.logger.error('❌ Cleanup failed:', error);
    }
  }

  /**
   * Process existing unvetted tokens in batches
   * Runs every 10 minutes to vet tokens that were added before n8n integration
   */
  @Cron('0 */30 * * * *', {
    name: 'vet-existing-tokens',
    timeZone: 'UTC',
  })
  async processExistingUnvettedTokens() {
    this.logger.log('🔄 Starting processExistingUnvettedTokens cron job...');
    
    try {
      const client = (this.repo as any)['prisma'] as any;
      // Get tokens that don't have a riskScore (unvetted) - more aggressive query
      const unvettedTokens = await client.listing.findMany({
        where: {
          riskScore: null,
          chain: 'SOLANA', // Only process SOLANA tokens for now
        },
        take: 20, // Process 20 at a time (increased from 10)
        orderBy: { createdAt: 'asc' }, // Process oldest first
      });

      if (unvettedTokens.length === 0) {
        this.logger.debug('No unvetted tokens found');
        return;
      }

      this.logger.log(`📋 Processing ${unvettedTokens.length} unvetted tokens with backend risk scoring...`);

      for (const token of unvettedTokens) {
        try {
          // Age check is done inside triggerN8nVettingForNewToken
          // It will skip tokens < 2 days old automatically (temporarily lowered for testing)
          this.logger.log(`🔄 Triggering vetting for token ${token.contractAddress} (chain: ${token.chain})`);
          await this.triggerN8nVettingForNewToken(token.contractAddress, token.chain.toLowerCase());
          // Add delay between tokens to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay (reduced from 2)
        } catch (error: any) {
          this.logger.error(`❌ Failed to process unvetted token ${token.contractAddress}: ${error.message}`);
          this.logger.error(`Stack: ${error.stack}`);
        }
      }

      this.logger.log(`✅ Completed processing ${unvettedTokens.length} unvetted tokens`);
    } catch (error: any) {
      this.logger.error(`Error processing unvetted tokens: ${error.message}`);
    }
  }

  // Pull trending/new SOL pairs (approx) from DexScreener using /dex/tokens & /dex/search endpoints
  // Run every 30 minutes to reduce Railway usage
  @Cron('0 */30 * * * *') // Every 30 minutes instead of every 5 seconds
  async scheduledFetchFeed() {
    const started = Date.now();
    let apiCalls = 0;
    let failures = 0;
    try {
      // Fetch data from all sources in parallel for efficiency
      const [dex, bird, heli, moralis, solscan] = await Promise.all([
        this.getDexScreenerFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; }),
        this.getBirdEyeFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; }),
        this.getHeliusFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; }),
        this.getMoralisFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; }),
        this.getSolscanFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; })
      ]);

      // Merge data from all sources
      const merged = this.mergeFeeds([dex, bird, heli, moralis, solscan]);
      
      // Enforce 100-token limit before upserting new tokens
      await this.enforceTokenLimit();
      
      const deltas = await this.upsertFromMerged(merged);

      // Broadcast deltas via WebSockets for real-time updates
      // Ensure all required fields are present before emitting
      if (deltas?.new?.length) {
        this.logger.log(`🆕 Broadcasting ${deltas.new.length} new listings via WebSocket`);
        deltas.new.forEach((d: any) => {
          // Add timestamp to track when the update was sent
          d.lastUpdated = Date.now();
          this.gateway.emitNew(d);
        });
      }
      
      if (deltas?.updated?.length) {
        this.logger.log(`📊 Broadcasting ${deltas.updated.length} listing updates via WebSocket`);
        deltas.updated.forEach((d: any) => {
          // Add timestamp to track when the update was sent
          d.lastUpdated = Date.now();
          this.gateway.emitUpdate(d);
        });
      }

      // Track API calls for metrics
      apiCalls += (dex ? dex.__calls ?? 1 : 0) + 
                 (bird ? bird.__calls ?? 1 : 0) + 
                 (heli ? heli.__calls ?? 1 : 0) + 
                 (moralis ? moralis.__calls ?? 1 : 0) + 
                 (solscan ? solscan.__calls ?? 1 : 0);
      this.metrics.incCounter('listing_api_calls_total', apiCalls);
      this.metrics.incCounter('listing_refresh_total', 1);
      const total = (deltas?.new?.length ?? 0) + (deltas?.updated?.length ?? 0);
      this.logger.log(`Listings refreshed: ${total} (new: ${deltas?.new?.length ?? 0}, updated: ${deltas?.updated?.length ?? 0})`);
    } catch (e: any) {
      failures += 1;
      this.logger.warn(`Feed fetch failed: ${e.message}`);
      this.metrics.incCounter('listing_refresh_failures_total', 1);
    } finally {
      const duration = (Date.now() - started) / 1000;
      this.metrics.observeDuration('listing_refresh_duration_seconds', duration);
    }
  }

  private async getDexScreenerFeed() {
    const key = this.cache.cacheKey('feed:dex', { chains: 'all' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Fetch multiple search queries to scale results beyond 300 pairs.
    // Deduplicate by baseToken.address or pairAddress.
    const queries = [
      // Solana
      'sol', 'sol usdc', 'sol raydium', 'sol jupiter', 'sol pump', 'sol meme', 'sol pepe', 'sol doge', 'sol cat', 'sol dexscreener',
      // Ethereum
      'eth', 'ethereum uniswap', 'eth meme', 'eth pepe',
      // BSC
      'bsc', 'binance pancakeswap', 'bsc meme', 'bsc pepe',
      // Base
      'base', 'base uniswap', 'base meme',
      // Sui
      'sui', 'sui meme',
      // Aptos
      'aptos', 'aptos meme',
    ];

    const requests = queries.map((q) => {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
      return axios.get(url, { timeout: 8000 }).then(r => r.data).catch(() => ({ pairs: [] }));
    });

    const results = await Promise.all(requests);

    // Merge and dedupe pairs
    const byKey = new Map<string, any>();
    for (const res of results) {
      const pairs: any[] = Array.isArray(res?.pairs) ? res.pairs : [];
      for (const p of pairs) {
        const base = p?.baseToken || {};
        const address = base?.address || p?.pairAddress;
        if (!address) continue;
        const keyAddr = `${p?.chainId || 'unknown'}|${address}`;
        if (!byKey.has(keyAddr)) byKey.set(keyAddr, p);
      }
    }

    // Cap to ~600 raw pairs; actual upsert will slice to 350
    const merged = { pairs: Array.from(byKey.values()).slice(0, 600) };
    // Reduce cache time to 5 seconds for more frequent updates
    await this.cache.set(key, merged, 5);
    return { ...merged, __calls: results.length };
  }

  private async getBirdEyeFeed() {
    const apiKey = this.configService.get('BIRDEYE_API_KEY');
    if (!apiKey) return null;
    const key = this.cache.cacheKey('feed:bird', { chain: 'solana' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Example endpoint: trending tokens (docs can vary by plan); fallback to top volume list
    const url = `https://public-api.birdeye.so/defi/v3/tokens/trending?chain=solana&sort_by=volume_h24&limit=100`;
    const { data } = await axios.get(url, { headers: { 'X-API-KEY': apiKey, 'accept': 'application/json' }, timeout: 8000 });
    await this.cache.set(key, data, 30);
    return { ...data, __calls: 1 };
  }

  // Enhanced Moralis feed fetching with better holder data and reduced cache time
  private async getMoralisFeed() {
    const apiKey = this.configService.get('MORALIS_API_KEY');
    if (!apiKey) return null;
 
    const key = this.cache.cacheKey('feed:moralis', { chain: 'solana' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Solana tokens by market cap
    const url = `https://deep-index.moralis.io/api/v2.2/market-data/solana/tokens?limit=100&sort=market_cap`;
    const { data } = await axios.get(url, {
      headers: { 'X-API-Key': apiKey, 'accept': 'application/json' },
      timeout: 8000,
    });

    // Debug: Log the first token to see the actual API response structure
    if (data?.result && data.result.length > 0) {
      console.log('🔍 Moralis API Response Sample:', JSON.stringify(data.result[0], null, 2));
    }

    // Normalize to match mergeFeeds shape
    const tokens = (data?.result ?? []).map((t: any) => ({
      address: t?.token_address,
      symbol: t?.symbol,
      name: t?.name,
      priceUsd: t?.price_usd ?? null,
      liquidityUsd: t?.liquidity_usd ?? null,
      fdv: t?.market_cap ?? null,
      volume24h: t?.volume_24h ?? null,
      holders: t?.holders ?? null,
      chain: 'solana',
      source: 'moralis',
    }));

    // Note: Moralis free tier doesn't provide holder counts in the market-data endpoint
    // and the separate holders endpoint requires paid tier or has rate limits
    // For now, we'll rely on the data from the main endpoint
    console.log(`📊 Moralis returned ${tokens.length} tokens`);
    
    // Check if any tokens have holder data
    const tokensWithHolders = tokens.filter(t => t.holders && t.holders > 0);
    if (tokensWithHolders.length > 0) {
      console.log(`✅ ${tokensWithHolders.length} tokens have holder data from Moralis`);
    } else {
      console.log(`⚠️ No holder data available from Moralis market-data endpoint (likely requires paid tier)`);
    }
    
    const enhancedTokens = tokens;

    const wrapped = { data: { tokens: enhancedTokens } };
    // Reduce cache time to 3 seconds for real-time updates
    await this.cache.set(key, wrapped, 3);
    return { ...wrapped, __calls: 1 };
  }


  private async getSolscanFeed() {
    const key = this.configService.get('SOLSCAN_API_KEY');
    if (!key) return null;
    const cacheKey = this.cache.cacheKey('feed:solscan', { chain: 'solana' });
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return { ...cached, __calls: 0 };

    try {
      // Fetch trending tokens from Solscan
      const response = await axios.get('https://api.solscan.io/token/list', {
        params: {
          sortBy: 'market_cap',
          direction: 'desc',
          limit: 100,
          offset: 0
        },
        headers: {
          'token': key,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        const tokens = response.data.data
          .filter((item: any) => item.address && item.symbol)
          .map((item: any) => ({
            address: item.address,
            symbol: item.symbol || '',
            name: item.name || item.symbol || '',
            chain: 'solana',
            source: 'solscan',
            holders: item.holder || 0,
            price: item.priceUsd || 0,
            volume24h: item.volume24h || 0,
            marketCap: item.marketCap || 0,
            liquidity: item.liquidity || 0,
            priceChange: {
              h24: item.priceChange24h || 0
            }
          }));

        const wrapped = { data: { tokens } };
        // Cache for 15 seconds for more frequent updates
        await this.cache.set(cacheKey, wrapped, 15);
        return { ...wrapped, __calls: 1 };
      }
    } catch (error: any) {
      console.error('Solscan feed error:', error?.message || 'Unknown error');
    }
    
    return null;
  }

  private async getHeliusFeed() {
    const key = process.env.HELIUS_API_KEY;
    if (!key) return null;
    const cacheKey = this.cache.cacheKey('feed:helius', { chain: 'solana' });
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return { ...cached, __calls: 0 };

    try {
      // Note: Helius doesn't provide a direct "trending tokens" endpoint
      // This method is primarily for NFTs, not fungible tokens
      // For now, return null to avoid incorrect data
      console.log('⚠️ Helius feed: No suitable endpoint for token holder data');
      return null;
      
      // Use Helius to get popular tokens based on transaction activity
      const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
      const response = await axios.post(url, {
        jsonrpc: '2.0',
        id: 'helius-popular-tokens',
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: 'All',
          page: 1,
          limit: 100
        }
      }, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data && response.data.result && Array.isArray(response.data.result.items)) {
        const tokens = response.data.result.items
          .filter((item: any) => item.content && item.content.metadata && item.id)
          .map((item: any) => {
            // Extract additional data from Helius response
            const metadata = item.content?.metadata || {};
            const tokenAmount = item.token_info?.supply ? 
              Number(item.token_info.supply) / Math.pow(10, item.token_info?.decimals || 9) : 0;
            
            return {
              address: item.id,
              symbol: metadata.symbol || '',
              name: metadata.name || '',
              chain: 'solana',
              source: 'helius',
              // Add additional fields that match the reference images
              priceUsd: item.price_info?.price_per_token || 0,
              marketCap: (item.price_info?.price_per_token || 0) * tokenAmount || 0,
              volume24h: item.price_info?.volume_24h || 0,
              holders: item.holder_count || 0,
              // Include creation date if available
              creationDate: item.first_verified_created_at || null,
              // Include additional metadata
              description: metadata.description || '',
              image: metadata.image || '',
              // Include token info
              decimals: item.token_info?.decimals || 9,
              supply: item.token_info?.supply || 0
            };
          });

        const wrapped = { data: { tokens } };
        // Cache for 15 seconds for more frequent updates
        await this.cache.set(cacheKey, wrapped, 15);
        return { ...wrapped, __calls: 1 };
      }
    } catch (error: any) {
      console.error('Helius feed error:', error?.message || 'Unknown error');
    }
    
    return null;
  }

  private isSolanaMint(addr: string | undefined | null): boolean {
    if (!addr) return false;
    if (addr.startsWith('0x')) return false; // EVM
    if (addr.includes('/') || addr.includes('.') || addr.includes(':')) return false; // cosmos/near paths
    const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58.test(addr);
  }

  private mapChainIdToEnum(chainId?: string): 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' {
    const raw = (chainId || '').toLowerCase();
    if (!raw) return 'UNKNOWN';
    if (raw.includes('sol')) return 'SOLANA';
    if (raw.includes('ethereum') || raw === 'eth' || raw.includes('eth')) return 'ETHEREUM';
    if (raw.includes('bsc') || raw.includes('binance')) return 'BSC';
    if (raw.includes('base')) return 'BASE';
    if (raw.includes('sui')) return 'SUI';
    if (raw.includes('aptos')) return 'APTOS';
    if (raw.includes('near')) return 'NEAR';
    if (raw.includes('osmo') || raw.includes('osmosis')) return 'OSMOSIS';
    return 'OTHER';
  }

  // Resolve token/logo URL with caching to enrich listings lacking images
  private async resolveLogoCached(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
    symbol?: string | null,
    name?: string | null,
  ): Promise<string | null> {
    try {
      const cacheKey = this.cache.cacheKey('logo', { chain, address });
      const cached = await this.cache.get<string | null>(cacheKey);
      if (typeof cached !== 'undefined' && cached !== null) return cached;

      const url = await this.resolveLogoNetwork(chain, address, symbol, name);
      // Cache for 24h; also cache null as a sentinel to avoid repeated lookups
      await this.cache.set(cacheKey, url ?? null, 24 * 60 * 60);
      return url ?? null;
    } catch {
      return null;
    }
  }

  // Network strategy: Jupiter (Solana) -> TrustWallet -> deterministic identicon
  private async resolveLogoNetwork(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
    symbol?: string | null,
    name?: string | null,
  ): Promise<string | null> {
    const candidates: (string | null)[] = [];

    // 1) Jupiter verified tokens list for Solana
    if (chain === 'SOLANA') {
      const jup = await this.getJupiterLogo(address).catch(() => null);
      if (jup) return jup;
    }

    // 2) TrustWallet assets repo paths (no API key required)
    candidates.push(this.trustWalletPathForChain(chain, address));

    // 3) As a last resort, use a deterministic identicon (always available)
    const seed = encodeURIComponent(address || symbol || name || 'token');
    candidates.push(`https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`);

    for (const url of candidates) {
      if (!url) continue;
      const ok = await this.urlExists(url).catch(() => false);
      if (ok) return url;
    }
    return null;
  }

  private async getJupiterLogo(address: string): Promise<string | null> {
    const key = this.cache.cacheKey('jup:tokens', {});
    let tokens = await this.cache.get<any[]>(key);
    if (!Array.isArray(tokens) || tokens.length === 0) {
      try {
        // Prefer verified list; fallback to full list if needed
        // Using lite-api.jup.ag as tokens.jup.ag is being phased out
        const { data } = await axios.get('https://lite-api.jup.ag/tokens?tags=verified', { timeout: 8000 });
        tokens = Array.isArray(data) ? data : [];
        if (tokens.length === 0) {
          const alt = await axios.get('https://lite-api.jup.ag/tokens', { timeout: 8000 }).then(r => r.data).catch(() => []);
          tokens = Array.isArray(alt) ? alt : [];
        }
        // Cache for 12h
        await this.cache.set(key, tokens, 12 * 60 * 60);
      } catch {
        tokens = [];
      }
    }
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    const found = tokens.find((t: any) => (t?.address || t?.mint) === address);
    return found?.logoURI || null;
  }

  private trustWalletPathForChain(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
  ): string | null {
    const base = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';
    const addr = address?.trim();
    if (!addr) return null;
    switch (chain) {
      case 'SOLANA':
        // SPL mint addresses are base58 and case-sensitive; TrustWallet uses exact mint path
        return `${base}/solana/assets/${addr}/logo.png`;
      case 'ETHEREUM':
        return `${base}/ethereum/assets/${addr}/logo.png`;
      case 'BSC':
        return `${base}/smartchain/assets/${addr}/logo.png`;
      case 'BASE':
        return `${base}/base/assets/${addr}/logo.png`;
      // Add more chains as needed when supported by TrustWallet repo
      default:
        return null;
    }
  }

  private async urlExists(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, { timeout: 2500, validateStatus: () => true });
      // GitHub raw returns 200 for present, 404 otherwise. Dicebear will return 200.
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  }

  private mergeFeeds(feeds: any[]) {
    const byKey = new Map<string, any>(); // key: chain|address
    
    // Track which fields we need to ensure are populated based on reference images
    const requiredFields = [
      'priceUsd', 'liquidityUsd', 'holders', 'volume', 'marketCap', 
      'priceChange', 'age', 'riskScore', 'communityScore'
    ];

    for (const feed of feeds) {
      if (!feed) continue;

      // DexScreener shape: { pairs: [...] }
      if (Array.isArray(feed.pairs)) {
        for (const p of feed.pairs.slice(0, 400)) {
          const base = p?.baseToken || {};
          const address = base?.address || p?.pairAddress;
          const chainEnum = this.mapChainIdToEnum(p?.chainId);
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          // Prefer only valid numeric market fields and presence of txns
          const priceUsdNum = Number(p?.priceUsd ?? existing.market?.priceUsd);
          const liquidityUsdNum = Number(p?.liquidity?.usd ?? existing.market?.liquidityUsd);
          const volumeH24Num = Number(p?.volume?.h24 ?? existing.market?.volume?.h24);
          const txns = p?.txns ?? existing.market?.txns ?? null;
          const hasTx = !!(txns && (typeof txns?.h1?.buys === 'number' || typeof txns?.h1?.sells === 'number' || typeof txns?.h24?.buys === 'number' || typeof txns?.h24?.sells === 'number'));
          if (!Number.isFinite(priceUsdNum) || !Number.isFinite(liquidityUsdNum) || !Number.isFinite(volumeH24Num) || !hasTx) {
            continue;
          }
          const market = {
            priceUsd: priceUsdNum,
            liquidityUsd: liquidityUsdNum,
            fdv: Number.isFinite(Number(p?.fdv)) ? Number(p?.fdv) : (Number.isFinite(Number(existing.market?.fdv)) ? Number(existing.market?.fdv) : null),
            // DexScreener exposes priceChange as priceChange.m5, h1, h6, h24 etc. when available
            priceChange: {
              m5: Number.isFinite(Number((p as any)?.priceChange?.m5)) ? Number((p as any)?.priceChange?.m5) : null, // 5 minute change (also used as 1m approximation)
              h1: Number.isFinite(Number((p as any)?.priceChange?.h1)) ? Number((p as any)?.priceChange?.h1) : null,
              h6: Number.isFinite(Number((p as any)?.priceChange?.h6)) ? Number((p as any)?.priceChange?.h6) : null,
              h24: Number.isFinite(Number((p as any)?.priceChange?.h24)) ? Number((p as any)?.priceChange?.h24) : null,
            },
            volume: { h24: volumeH24Num },
            txns,
            pairAddress: p?.pairAddress ?? existing.market?.pairAddress ?? null,
            chainId: p?.chainId ?? null,
            source: 'dexscreener',
            // Preserve holders from existing data if available (DexScreener doesn't provide holders)
            holders: existing.market?.holders ?? null,
          };
          const logoUrl = p?.info?.imageUrl || base?.imageUrl || base?.logoURI || existing.logoUrl || null;
          byKey.set(key, { chain: chainEnum, address, symbol: base?.symbol, name: base?.name, market, logoUrl });
        }
      }

      // BirdEye shape (example): { data: { tokens: [...] }} or { data: [] }
      const birdTokens = feed?.data?.tokens || feed?.data || [];
      if (Array.isArray(birdTokens)) {
        for (const t of birdTokens.slice(0, 400)) {
          const address = t?.address || t?.mint || t?.tokenAddress;
          const chainEnum = this.mapChainIdToEnum(t?.chain || t?.chainId);
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          // Only include when required numeric fields are present
          const priceUsdNum = Number((t?.priceUsd ?? t?.price ?? existing.market?.priceUsd));
          const liquidityUsdNum = Number((t?.liquidity ?? existing.market?.liquidityUsd));
          const volumeH24Num = Number((t?.volume24h ?? t?.v24h ?? existing.market?.volume?.h24));
          if (!Number.isFinite(priceUsdNum) || !Number.isFinite(liquidityUsdNum) || !Number.isFinite(volumeH24Num)) {
            continue;
          }
          const market = {
            priceUsd: priceUsdNum,
            liquidityUsd: liquidityUsdNum,
            fdv: Number.isFinite(Number(t?.fdv)) ? Number(t?.fdv) : (Number.isFinite(Number(existing.market?.fdv)) ? Number(existing.market?.fdv) : null),
            // BirdEye sometimes exposes price change fields differently; keep placeholders
            priceChange: {
              h1: Number.isFinite(Number((t as any)?.priceChange1h)) ? Number((t as any)?.priceChange1h) : (existing.market?.priceChange?.h1 ?? null),
              h6: Number.isFinite(Number((t as any)?.priceChange6h)) ? Number((t as any)?.priceChange6h) : (existing.market?.priceChange?.h6 ?? null),
              h24: Number.isFinite(Number((t as any)?.priceChange24h)) ? Number((t as any)?.priceChange24h) : (existing.market?.priceChange?.h24 ?? null),
            },
            volume: { h24: volumeH24Num },
            chainId: t?.chain || t?.chainId || null,
            source: 'birdeye',
          };
          // Require txns to exist in the merged record. BirdEye doesn't provide txns, so only use it to enhance an existing DexScreener record with txns.
          if (!existing.market || !existing.market?.txns) {
            // No txns present → skip BirdEye-only entries per spec
            continue;
          }
          const merged = {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...existing.market, ...market, txns: existing.market.txns }, // preserve txns from DexScreener
            logoUrl: t?.logo || t?.logoURI || existing.logoUrl || null,
          };
          byKey.set(key, merged);
        }
      }

      // Moralis shape: { data: { tokens: [...] } }
      const moraTokens = feed?.data?.tokens || [];
      if (Array.isArray(moraTokens)) {
        for (const t of moraTokens.slice(0, 400)) {
          const address = t?.address;
          // Support multiple chains, not just Solana
          const chainEnum = this.mapChainIdToEnum(t?.chain || 'solana');
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          
          // Ensure numeric values are properly converted
          const priceUsdNum = Number(t?.priceUsd ?? existing.market?.priceUsd ?? 0);
          const liquidityUsdNum = Number(t?.liquidityUsd ?? existing.market?.liquidityUsd ?? 0);
          const fdvNum = Number(t?.fdv ?? existing.market?.fdv ?? 0);
          const volumeH24Num = Number(t?.volume24h ?? existing.market?.volume?.h24 ?? 0);
          
          // Ensure holders is properly extracted and preserved
          // Try multiple possible holder field names and formats
          let holdersNum = null;
          if (t?.holders) {
            const parsed = parseInt(t.holders.toString(), 10);
            if (Number.isFinite(parsed)) holdersNum = parsed;
          } else if (t?.holderCount) {
            const parsed = parseInt(t.holderCount.toString(), 10);
            if (Number.isFinite(parsed)) holdersNum = parsed;
          } else if (t?.holder_count) {
            const parsed = parseInt(t.holder_count.toString(), 10);
            if (Number.isFinite(parsed)) holdersNum = parsed;
          }
          
          // If we still don't have holders, use existing value
          if (holdersNum === null && existing.market?.holders) {
            holdersNum = existing.market.holders;
          }
          
          // Calculate age if creation date is available
          let ageInDays = null;
          if (t?.creationDate) {
            const creationDate = new Date(t.creationDate);
            if (!isNaN(creationDate.getTime())) {
              ageInDays = (Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24);
            }
          }
          
          // Extract price change data if available
          const priceChangeH24 = t?.priceChange?.h24 || t?.priceChange24h || 0;
          const priceChangeH1 = t?.priceChange?.h1 || t?.priceChange1h || 0;
          
          // Debug logging for Moralis holders
          if (Number.isFinite(Number(holdersNum)) && Number(holdersNum) > 0) {
            console.log(`👥 Moralis holders for ${t?.symbol || address}: ${holdersNum}`);
          }
          
          const market = {
            priceUsd: Number.isFinite(priceUsdNum) ? priceUsdNum : 0,
            liquidityUsd: Number.isFinite(liquidityUsdNum) ? liquidityUsdNum : 0,
            fdv: Number.isFinite(fdvNum) ? fdvNum : 0,
            volume: { h24: Number.isFinite(volumeH24Num) ? volumeH24Num : 0 },
            holders: Number.isFinite(Number(holdersNum)) ? Number(holdersNum) : null,
            chainId: t?.chain || 'solana',
            source: 'moralis',
            // Include age if available
            age: ageInDays,
            // Include price change data
            priceChange: {
              h24: Number.isFinite(Number(priceChangeH24)) ? Number(priceChangeH24) : (existing.market?.priceChange?.h24 ?? 0),
              h1: Number.isFinite(Number(priceChangeH1)) ? Number(priceChangeH1) : (existing.market?.priceChange?.h1 ?? 0),
              h6: existing.market?.priceChange?.h6 ?? 0
            },
            // Include risk score if available or preserve existing
            riskScore: t?.riskScore || existing.market?.riskScore || null,
            // Include community score if available or preserve existing
            communityScore: t?.communityScore || existing.market?.communityScore || null,
          } as any;
          
          byKey.set(key, {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...(existing.market || {}), ...market },
            logoUrl: existing.logoUrl ?? null,
          });
        }
      }
      
      // Solscan shape: { data: { tokens: [...] } }
      const solscanTokens = feed?.data?.tokens || [];
      if (Array.isArray(solscanTokens)) {
        for (const t of solscanTokens.slice(0, 400)) {
          const address = t?.address;
          const chainEnum = 'SOLANA' as const;
          if (!address) continue;
          if (!this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          
          // Ensure numeric values are properly converted
          const priceUsdNum = Number(t?.price ?? existing.market?.priceUsd ?? 0);
          const marketCapNum = Number(t?.marketCap ?? existing.market?.fdv ?? 0);
          const volumeH24Num = Number(t?.volume24h ?? existing.market?.volume?.h24 ?? 0);
          const holdersNum = Number(t?.holders ?? existing.market?.holders ?? 0);
          
          // Extract price change data
          const priceChangeH24 = t?.priceChange?.h24 || 0;
          
          // Debug logging for Solscan holders
          if (Number.isFinite(holdersNum) && holdersNum > 0) {
            console.log(`👥 Solscan holders for ${t?.symbol || address}: ${holdersNum}`);
          }
          
          const market = {
            priceUsd: Number.isFinite(priceUsdNum) ? priceUsdNum : 0,
            liquidityUsd: Number(t?.liquidity ?? existing.market?.liquidityUsd ?? 0),
            fdv: Number.isFinite(marketCapNum) ? marketCapNum : 0,
            volume: { h24: Number.isFinite(volumeH24Num) ? volumeH24Num : 0 },
            holders: Number.isFinite(holdersNum) ? holdersNum : null,
            chainId: 'solana',
            source: 'solscan',
            priceChange: {
              m5: existing.market?.priceChange?.m5 ?? null, // Preserve m5 if exists, Solscan doesn't provide it
              h24: Number.isFinite(Number(priceChangeH24)) ? Number(priceChangeH24) : (existing.market?.priceChange?.h24 ?? null),
              h1: existing.market?.priceChange?.h1 ?? null,
              h6: existing.market?.priceChange?.h6 ?? null
            }
          } as any;
          
          byKey.set(key, {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...(existing.market || {}), ...market },
            logoUrl: existing.logoUrl ?? null,
          });
        }
      }
      
      // Helius shape: { data: { tokens: [...] } }
      const heliusTokens = feed?.data?.tokens || [];
      if (Array.isArray(heliusTokens)) {
        for (const t of heliusTokens.slice(0, 400)) {
          const address = t?.address;
          const chainEnum = 'SOLANA' as const;
          if (!address) continue;
          if (!this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          
          // Extract creation date and calculate age if available
          let ageInDays = null;
          if (t?.creationDate) {
            const creationDate = new Date(t.creationDate);
            if (!isNaN(creationDate.getTime())) {
              ageInDays = (Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24);
            }
          }
          
          // Ensure numeric values are properly converted
          const priceUsdNum = Number(t?.priceUsd ?? existing.market?.priceUsd ?? 0);
          const marketCapNum = Number(t?.marketCap ?? existing.market?.fdv ?? 0);
          const volumeH24Num = Number(t?.volume24h ?? existing.market?.volume?.h24 ?? 0);
          const holdersNum = Number(t?.holders ?? existing.market?.holders ?? 0);
          
          const market = {
            priceUsd: Number.isFinite(priceUsdNum) ? priceUsdNum : 0,
            liquidityUsd: Number(t?.liquidityUsd ?? existing.market?.liquidityUsd ?? 0),
            fdv: Number.isFinite(marketCapNum) ? marketCapNum : 0,
            volume: { h24: Number.isFinite(volumeH24Num) ? volumeH24Num : 0 },
            holders: Number.isFinite(holdersNum) ? holdersNum : null,
            chainId: 'solana',
            source: 'helius',
            age: ageInDays ?? existing.market?.age ?? null,
            // Include additional metadata if available
            description: t?.description || existing.market?.description || null,
            decimals: t?.decimals || existing.market?.decimals || null,
            supply: t?.supply || existing.market?.supply || null
          } as any;
          
          byKey.set(key, {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...(existing.market || {}), ...market },
            logoUrl: t?.image || existing.logoUrl || null,
          });
        }
      }
    }

    // Ensure all required fields are present in each record
    const result = Array.from(byKey.values()).map(item => {
      // Make sure market object exists
      if (!item.market) item.market = {};
      
      // Preserve holders as null if unavailable (don't default to 0)
      // Frontend will display "N/A" for null values
      if (item.market.holders === undefined) {
        item.market.holders = null;
      }
      
      // Ensure price change fields are present
      if (!item.market.priceChange) item.market.priceChange = {};
      if (item.market.priceChange.m5 === undefined) item.market.priceChange.m5 = null; // 5 minute change (also used as 1m approximation)
      if (item.market.priceChange.h24 === undefined) item.market.priceChange.h24 = null;
      if (item.market.priceChange.h1 === undefined) item.market.priceChange.h1 = null;
      if (item.market.priceChange.h6 === undefined) item.market.priceChange.h6 = null;
      
      // Ensure volume field is present
      if (!item.market.volume) item.market.volume = {};
      if (item.market.volume.h24 === undefined) item.market.volume.h24 = 0;
      
      return item;
    });
    
    return result;
  }

  private classifyCategory(x: { symbol?: string; name?: string; market?: any }): 'MEME' | 'DEFI' | 'NFT' | 'OTHER' | 'UNKNOWN' {
    const symbol = (x.symbol || '').toLowerCase();
    const name = (x.name || '').toLowerCase();
    const fdv = Number(x.market?.fdv ?? 0);
    const liq = Number(x.market?.liquidityUsd ?? 0);
    // Heuristics: small FDV, low liquidity, meme-ish names/symbols
    const memeHints = ['pepe', 'wojak', 'doge', 'bonk', 'elon', 'meme', 'cat', 'kitten', 'baby', 'moon', 'pump'];
    const hasMemeWord = memeHints.some((w) => symbol.includes(w) || name.includes(w));
    if (hasMemeWord || (fdv > 0 && fdv < 10_000_000 && liq > 0 && liq < 2_000_000)) return 'MEME';
    return 'OTHER';
  }

  /**
   * Enforce 25-token limit with strict age filtering (>14 days)
   * This preserves API keys and ensures only "presentable" tokens with badges are shown.
   */
  private async enforceTokenLimit() {
    try {
      const client = (this.repo as any)['prisma'] as any;
      
      // Get total count
      const totalCount = await client.listing.count();
      this.logger.log(`📊 Current token count: ${totalCount}`);
      
      // Strict limit of 25 tokens for the "Presentable Model"
      if (totalCount <= 25) {
        return;
      }
      
      const tokensToRemove = totalCount - 25;
      
      // Remove the oldest tokens (or those with lowest scores) to maintain exactly 25
      const tokensToDelete = await client.listing.findMany({
        orderBy: [
          { riskScore: 'asc' }, // Remove low quality first
          { createdAt: 'asc' }  // Then oldest
        ],
        take: tokensToRemove,
        select: { id: true }
      });
      
      if (tokensToDelete.length > 0) {
        const idsToDelete = tokensToDelete.map((t: any) => t.id);
        await client.listing.deleteMany({
          where: { id: { in: idsToDelete } }
        });
        
        this.logger.log(`🗑️ Rotation: Removed ${tokensToDelete.length} tokens to maintain the 25-token presentable model.`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error enforcing token limit: ${error.message}`);
    }
  }

  private async upsertFromMerged(items: any[]) {
    const deltas = { new: [] as any[], updated: [] as any[] };
    if (!Array.isArray(items) || !items.length) return deltas;
    
    // FILTER: Only tokens older than 14 days (per Owner's request)
    // This ensures they qualify for Seed/Sprout/Bloom badges
    const ageFilteredItems = items.filter(x => {
      const age = x.market?.age;
      // If age is null, we might still want to check if it's a known older token 
      // but for strictness we follow the 14-day rule.
      return age === null || age >= 14; 
    });

    // Limit to 25 tokens max, sorted by Volume + Liquidity (High Quality)
    const sortedItems = ageFilteredItems
      .sort((a, b) => {
        const aVolume = Number(a.market?.volume?.h24 ?? 0);
        const bVolume = Number(b.market?.volume?.h24 ?? 0);
        const aLiquidity = Number(a.market?.liquidityUsd ?? 0);
        const bLiquidity = Number(b.market?.liquidityUsd ?? 0);
        return (bVolume + bLiquidity) - (aVolume + aLiquidity);
      })
      .slice(0, 25);
    
    this.logger.log(`🎯 Processing ${sortedItems.length} high-quality tokens (>14 days old)`);

    for (const x of sortedItems) {
      const chain = x?.chain as 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN';
      const address = x?.address as string;
      if (!chain || !address) continue;
      if (chain === 'SOLANA' && !this.isSolanaMint(address)) continue;
      try {
        const category = this.classifyCategory(x);
        const before = await this.repo.findOne(address);
        // Enrich missing logo with TrustWallet assets or identicon (cached)
        const resolvedLogo = x.logoUrl || await this.resolveLogoCached(chain, address, x.symbol, x.name);
        
        // Always try to fetch fresh holder data (feed data might be stale or missing)
        // This ensures holders are updated even if they were previously null or outdated
        let holderCount: number | null = x.market?.holders ?? null;
          try {
            const fetchedHolders = await this.analyticsService.getHolderCount(address, chain);
            if (fetchedHolders !== null && fetchedHolders > 0) {
              holderCount = fetchedHolders;
              console.log(`👥 Fetched holders for ${x.symbol || address}: ${holderCount}`);
            } else {
            // If fetch returned null/0, preserve existing value if it exists, otherwise set to null
            if (holderCount === null || holderCount === 0) {
              holderCount = null;
              console.log(`⚠️ Holder count unavailable for ${x.symbol || address} - will display as N/A`);
            } else {
              // Keep existing holder count if fetch failed but we have an existing value
              console.log(`⚠️ Failed to fetch fresh holders for ${x.symbol || address}, preserving existing value: ${holderCount}`);
            }
            }
          } catch (error) {
            console.log(`⚠️ Failed to fetch holders for ${x.symbol || address}: ${error instanceof Error ? error.message : String(error)}`);
          // On error, preserve existing value if available, otherwise set to null
          if (holderCount === null || holderCount === 0) {
            holderCount = null;
          }
        }
        
        // Ensure all required fields from reference images are included
        const marketData = {
          ...(x.market ?? {}),
          category,
          logoUrl: resolvedLogo ?? null,
          // Ensure these fields are always present
          holders: holderCount,
          priceUsd: x.market?.priceUsd ?? 0,
          liquidityUsd: x.market?.liquidityUsd ?? 0,
          fdv: x.market?.fdv ?? 0,
          volume: x.market?.volume ?? { h24: 0 },
          priceChange: x.market?.priceChange ?? { m5: null, h1: null, h6: null, h24: null },
          // Include risk and community scores
          riskScore: x.market?.riskScore ?? null,
          communityScore: x.market?.communityScore ?? null,
          // Include age information
          age: x.market?.age ?? null,
          // Last updated timestamp for real-time display
          lastUpdated: Date.now()
        };
        
        await this.repo.upsertMarketMetadata({
          contractAddress: address,
          chain,
          symbol: x.symbol ?? null,
          name: x.name ?? null,
          market: marketData,
        });
        const after = await this.repo.findOne(address);
        const m = (after as any)?.metadata?.market || {};
        const t = (after as any)?.metadata?.token || {};
        // Build payload to match frontend Listing shape where possible
        const payload = {
          id: after?.id ?? `${address}`,
          contractAddress: address,
          chain,
          symbol: after?.symbol ?? x.symbol ?? null,
          name: after?.name ?? x.name ?? null,
          category,
          priceUsd: after?.priceUsd ?? x.market?.priceUsd ?? null,
          change1m: (after as any)?.change1m ?? m?.priceChange?.m5 ?? null, // Using m5 as 1m approximation
          change5m: (after as any)?.change5m ?? m?.priceChange?.m5 ?? null, // Exact 5m data
          change1h: (after as any)?.change1h ?? m?.priceChange?.h1 ?? null,
          change6h: (after as any)?.change6h ?? m?.priceChange?.h6 ?? null,
          change24h: (after as any)?.change24h ?? m?.priceChange?.h24 ?? null,
          liquidityUsd: after?.liquidityUsd ?? x.market?.liquidityUsd ?? null,
          marketCap: (after as any)?.marketCap ?? m?.fdv ?? m?.marketCap ?? null,
          volume24h: after?.volume24h ?? x.market?.volume?.h24 ?? x.market?.volume24h ?? null,
          holders: (after as any)?.holders ?? t?.holder_count ?? null,
          age: (after as any)?.age ?? t?.age_display_short ?? t?.age_display ?? null,
          communityScore: (after as any)?.communityScore ?? null,
          riskScore: after?.riskScore ?? null,
          txCount1h: (after?.txCount1h ?? (((x.market?.txns?.h1?.buys ?? 0) + (x.market?.txns?.h1?.sells ?? 0)))) ?? null,
          txCount24h: (after?.txCount24h ?? (((x.market?.txns?.h24?.buys ?? 0) + (x.market?.txns?.h24?.sells ?? 0)))) ?? null,
          logoUrl: x.logoUrl ?? m?.logoUrl ?? null,
          updatedAt: after?.updatedAt ?? new Date().toISOString(),
          createdAt: after?.createdAt ?? new Date().toISOString(),
        } as any;
        if (!before) {
          deltas.new.push(payload);
          // ALWAYS trigger vetting for new tokens (no age check - process all tokens)
          // This ensures all tokens go through Pillar 1 and get tier assigned
          if (!after?.riskScore && this.n8nService && this.externalApisService) {
            this.triggerN8nVettingForNewToken(address, chain).catch((error) => {
              this.logger.warn(`Failed to trigger vetting for new token ${address}: ${error.message}`);
            });
          } else if (!after?.riskScore) {
            // If n8n service not available, log warning
            this.logger.warn(`⚠️ New token ${address} created but vetting services not available - tier will remain null`);
          }
        } else {
          // For existing tokens, trigger vetting if they don't have a tier yet
          if (!after?.tier && !after?.riskScore && this.n8nService && this.externalApisService) {
            this.triggerN8nVettingForNewToken(address, chain).catch((error) => {
              this.logger.warn(`Failed to trigger vetting for existing token ${address}: ${error.message}`);
            });
          }
          deltas.updated.push(payload);
        }
        this.metrics.incCounter(`listing_ingested_total{chain="${chain}"}`, 1);
      } catch (e: any) {
        this.logger.debug(`Upsert merged failed: ${e.message}`);
      }
    }
    return deltas;
  }

  private async upsertFromDexPairs(feed: any) {
    if (!feed) return;
    const pairs: any[] = Array.isArray(feed?.pairs) ? feed.pairs : [];
    const top = pairs.slice(0, 100); // cap to 100 per cycle

    for (const p of top) {
      try {
        // Dex pair schema fields of interest
        const token = p?.baseToken || {};
        const contractAddress = token?.address || p?.pairAddress || null;
        if (!contractAddress) continue;

        const market = {
          priceUsd: p?.priceUsd ?? null,
          liquidityUsd: p?.liquidity?.usd ?? null,
          fdv: p?.fdv ?? null,
          volume: {
            h24: p?.volume?.h24 ?? null,
            h6: p?.volume?.h6 ?? null,
            h1: p?.volume?.h1 ?? null,
          },
          txns: p?.txns ?? null,
          pairAddress: p?.pairAddress ?? null,
          chainId: p?.chainId ?? 'solana',
          dexId: p?.dexId ?? null,
        };

        const chain = this.mapChainIdToEnum(p?.chainId);
        await this.repo.upsertMarketMetadata({
          contractAddress,
          chain,
          symbol: token?.symbol ?? null,
          name: token?.name ?? null,
          market,
        });
      } catch (e: any) {
        this.logger.debug(`Upsert from dex failed: ${e.message}`);
      }
    }
  }

  /**
   * Complete 24-Hour Rotation
   * Wipes existing listings to allow a fresh set of 25 tokens to be fetched and vetted.
   * This keeps the "Presentable Model" fresh and dynamic.
   */
  @Cron('0 0 * * *') // Every midnight
  async dailyRotation() {
    try {
      this.logger.log('🌅 Starting Daily Rotation: Clearing database for fresh 25 tokens...');
      const client = (this.repo as any)['prisma'] as any;
      
      const deletedListings = await client.listing.deleteMany({});
      const deletedScans = await client.scanResult.deleteMany({});
      
      this.logger.log(`✅ Daily Rotation Complete: Deleted ${deletedListings.count} listings and ${deletedScans.count} scans.`);
      
      // Immediately trigger a fetch to populate with fresh tokens
      await this.scheduledFetchFeed();
    } catch (error: any) {
      this.logger.error('❌ Daily Rotation failed:', error);
    }
  }

  /**
   * Enforce 25-token limit and rotation (runs every 6 hours)
   * This is a "sanity check" to keep the count at 25.
   */
  @Cron('0 0 */6 * * *') // Every 6 hours
  async enforceTokenLimitRotation() {
    this.logger.log('🔄 Running 6-hour token count check...');
    await this.enforceTokenLimit();
  }

  // Phase 1 live updating: refresh all listings every 30 minutes using scan enrichment
  // Increased from 5 minutes to 30 minutes to reduce API usage and prevent rate limiting
  @Cron('0 */30 * * * *') // Every 30 minutes to keep data fresh
  async scheduledRefreshAll() {
    const client = (this.repo as any)['prisma'] as any;
    const rows: { contractAddress: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' }[] = await client.listing.findMany({ select: { contractAddress: true, chain: true } });

    // Count per chain and total
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.chain] = (counts[r.chain] ?? 0) + 1;
    const total = rows.length;
    for (const [chain, count] of Object.entries(counts)) {
      this.metrics.incCounter(`listing_per_chain_total{chain="${chain}"}`, count);
    }

    // Only enqueue SOLANA listings for enrichment
    const solRows = rows.filter(r => r.chain === 'SOLANA');
    this.logger.log(`Solana listings queued: ${solRows.length} / Total listings: ${total}`);

    for (const { contractAddress } of solRows) {
      this.enqueue({ address: contractAddress, chain: 'SOLANA' });
    }
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    let refreshed = 0, apiCalls = 0, failures = 0;
    try {
      while (this.queue.length) {
        const item = this.queue.shift() as { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' } | string | undefined;
        if (!item) continue;
        const address = typeof item === 'string' ? item : item.address;
        const chain = typeof item === 'string' ? 'SOLANA' : item.chain;
        try {
          if (chain !== 'SOLANA') {
            // Skip enrichment for non-SOLANA for now
            await this.repo.persistScanAndUpsertListing({
              contractAddress: address,
              chain,
              token: null,
              riskScore: null,
              tier: null,
              summary: `${chain} enrichment not supported yet`,
            });
            continue;
          }

          // For SOLANA tokens, use Pillar1RiskScoringService (new system)
          // For other chains, use old scanService for now
          if (chain === 'SOLANA') {
            // Use comprehensive vetting with Pillar1RiskScoringService
            this.logger.log(`🔄 Processing ${address} with Pillar 1 risk scoring`);
            try {
              // Trigger comprehensive vetting (this uses Pillar1RiskScoringService)
              await this.triggerN8nVettingForNewToken(address, chain.toLowerCase());
              apiCalls += 1;
              
              // Fetch updated listing to get the risk score and tier
              const updated = await this.repo.findOne(address);
              if (updated) {
                // Emit delta update
                this.gateway.emitUpdate({ 
                  chain, 
                  contractAddress: address, 
                  tier: updated.tier, 
                  riskScore: updated.riskScore, 
                  communityScore: (updated as any)?.communityScore ?? null 
                });
                refreshed += 1;
                this.logger.log(`✅ Refreshed ${chain}:${address} - Risk: ${updated.riskScore}, Tier: ${updated.tier || 'none'}`);
              }
            } catch (error: any) {
              this.logger.warn(`Failed to process ${address} with Pillar 1: ${error.message}`);
              // Fallback to old scanService if Pillar 1 fails
              try {
                const result = await this.scanService.scanToken(address, undefined, chain);
                apiCalls += 1;
                const { listing: updated } = await this.repo.persistScanAndUpsertListing({
                  contractAddress: address,
                  chain,
                  token: result.metadata,
                  riskScore: result.risk_score,
                  tier: result.tier,
                  summary: result.summary,
                });
                this.gateway.emitUpdate({ chain, contractAddress: address, tier: result.tier, riskScore: result.risk_score, communityScore: (updated as any)?.communityScore ?? null });
                refreshed += 1;
                this.logger.log(`Refreshed ${chain}:${address} (fallback to old system)`);
              } catch (fallbackError: any) {
                failures += 1;
                this.logger.warn(`Refresh failed for ${chain}:${address}: ${fallbackError.message}`);
              }
            }
          } else {
            // For non-SOLANA chains, use old scanService for now
            const result = await this.scanService.scanToken(address, undefined, chain);
            apiCalls += 1;
            const { listing: updated } = await this.repo.persistScanAndUpsertListing({
              contractAddress: address,
              chain,
              token: result.metadata,
              riskScore: result.risk_score,
              tier: result.tier,
              summary: result.summary,
            });
            // Emit delta update for enrichment, include communityScore
            this.gateway.emitUpdate({ chain, contractAddress: address, tier: result.tier, riskScore: result.risk_score, communityScore: (updated as any)?.communityScore ?? null });
            refreshed += 1;
            this.logger.log(`Refreshed ${chain}:${address}`);
          }
        } catch (e: any) {
          failures += 1;
          this.logger.warn(`Refresh failed for ${chain}:${address}: ${e.message}`);
        }
      }
    } finally {
      this.running = false;
      this.stats.cycles += 1;
      this.stats.refreshed += refreshed;
      this.stats.apiCalls += apiCalls;
      this.stats.failures += failures;
      this.stats.lastDurationMs = Date.now() - started;
      this.logger.log(`Refresh cycle complete: refreshed=${refreshed}, apiCalls=${apiCalls}, failures=${failures}, durationMs=${this.stats.lastDurationMs}`);
    }
  }

  /**
   * Trigger n8n vetting for a new token with COMPLETE data
   * Fetches data from DexScreener, Helius, Alchemy, and BearTree APIs
   * This is called asynchronously when a new listing is created
   */
  private async triggerN8nVettingForNewToken(contractAddress: string, chain: string) {
    try {
      this.logger.debug(`🔍 Fetching comprehensive data for n8n vetting: ${contractAddress} on ${chain}`);
      
      // Fetch data from multiple sources in parallel (same as CronService.fetchAllTokenData)
      const [dexScreenerData, combinedData, imageUrl] = await Promise.all([
        this.externalApisService.fetchDexScreenerData(contractAddress, chain.toLowerCase()),
        this.externalApisService.fetchCombinedTokenData(contractAddress, chain.toLowerCase()),
        this.tokenImageService.fetchTokenImage(contractAddress, chain),
      ]);

      // Fetch Helius data (token metadata, holders, creation date)
      const heliusData = await this.fetchHeliusData(contractAddress);
      
      // Fetch Alchemy data (if available)
      const alchemyData = await this.fetchAlchemyData(contractAddress);
      
      // Fetch Helius BearTree data (developer info)
      const bearTreeData = await this.fetchHeliusBearTreeData(contractAddress);

      // Extract token info
      const pair = dexScreenerData || combinedData?.dexScreener;
      const baseToken = (pair?.baseToken || {}) as { name?: string; symbol?: string; decimals?: number };
      const gmgnData = (combinedData?.gmgn as any) || {};
      
      // Extract trading and holders data for age estimation
      const tradingData = {
        volume24h: Number(pair?.volume?.h24 || combinedData?.gmgn?.volume24h || 0),
        liquidity: Number(pair?.liquidity?.usd || combinedData?.gmgn?.liquidity || 0),
      };
      const holdersData = {
        count: heliusData?.holderCount || combinedData?.gmgn?.holders || 0,
      };

      // Calculate token age - try multiple sources
      const creationTimestamp = 
        heliusData?.creationTimestamp ||           // Helius RPC (primary)
        pair?.pairCreatedAt ||                     // DexScreener pair creation
        null;

      let tokenAge = 0;

      if (creationTimestamp) {
        // Determine if timestamp is in seconds or milliseconds
        // Timestamps > 1e12 are in milliseconds, < 1e12 are in seconds
        const timestampMs = creationTimestamp > 1e12 
          ? creationTimestamp  // Already in milliseconds
          : creationTimestamp * 1000; // Convert seconds to milliseconds
        
        // Calculate age from timestamp
        tokenAge = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));
        this.logger.debug(`📅 Token ${contractAddress} age calculated from timestamp: ${tokenAge} days`);
      } else {
        // Fallback: Try to get age from existing listing in database
        try {
          const existingListing = await this.repo.findOne(contractAddress);
          if (existingListing?.createdAt) {
            const dbAge = Math.floor((Date.now() - new Date(existingListing.createdAt).getTime()) / (1000 * 60 * 60 * 24));
            tokenAge = Math.max(0, dbAge);
            this.logger.debug(`📅 Using database createdAt for ${contractAddress} age: ${tokenAge} days`);
          } else {
            // Last resort: Estimate based on activity
            const hasSignificantVolume = tradingData.volume24h > 50000;
            const hasManyHolders = holdersData.count > 500;
            const hasEstablishedLiquidity = tradingData.liquidity > 100000;
            
            if (hasSignificantVolume || hasManyHolders || hasEstablishedLiquidity) {
              // Conservative estimate: assume minimum 7 days old for tokens with significant activity
              tokenAge = 7;
              this.logger.debug(`⚠️ No timestamp for ${contractAddress}, estimating minimum age: 7 days (based on activity)`);
            } else {
              // Very new token with no activity - likely < 1 day
              tokenAge = 0;
              this.logger.debug(`⚠️ No timestamp for ${contractAddress}, no significant activity - age: 0 days`);
            }
          }
        } catch (error) {
          this.logger.debug(`⚠️ Could not fetch existing listing for age calculation: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Log age calculation details for debugging
      this.logger.debug(`🔍 Age calculation for ${contractAddress}:`);
      this.logger.debug(`  - heliusData?.creationTimestamp: ${heliusData?.creationTimestamp || 'null'}`);
      this.logger.debug(`  - pair?.pairCreatedAt: ${pair?.pairCreatedAt || 'null'}`);
      this.logger.debug(`  - Final tokenAge: ${tokenAge} days`);

      // AGE FILTER: Removed 14-day minimum to allow more tokens to be scanned
      // Tokens of any age can now be scanned and vetted
      // The tier calculation will handle age requirements (Seed: 14-21 days, etc.)
      this.logger.log(`✅ Processing token ${contractAddress} (age: ${tokenAge} days) with Pillar 1 risk scoring`);

      // Build COMPLETE payload with all required data for n8n risk scoring
      const payload = {
        contractAddress,
        chain: chain.toLowerCase(),
        tokenInfo: {
          name: baseToken.name || gmgnData?.name || 'Unknown',
          symbol: baseToken.symbol || gmgnData?.symbol || 'UNKNOWN',
          image: imageUrl, // Token image from TokenImageService
          decimals: baseToken.decimals || gmgnData?.decimals || 6,
          description: gmgnData?.description || null,
          websites: combinedData?.gmgn?.socials?.website ? [combinedData.gmgn.socials.website] : [],
          socials: [
            combinedData?.gmgn?.socials?.twitter,
            combinedData?.gmgn?.socials?.telegram,
          ].filter(Boolean),
        },
        security: {
          isMintable: heliusData?.isMintable ?? alchemyData?.isMintable ?? false,
          isFreezable: heliusData?.isFreezable ?? alchemyData?.isFreezable ?? false,
          lpLockPercentage: (pair?.liquidity as any)?.lockedPercentage || bearTreeData?.lpLockPercentage || 0,
          totalSupply: Number(heliusData?.totalSupply || combinedData?.gmgn?.totalSupply || 0),
          circulatingSupply: Number(heliusData?.circulatingSupply || combinedData?.gmgn?.circulatingSupply || 0),
          lpLocks: bearTreeData?.lpLocks || [],
        },
        holders: {
          // Prioritize Birdeye (most accurate for Solana), then AnalyticsService (multi-API), then gmgn
          // Use null check to distinguish between 0 (no data) and actual 0 holders
          count: (combinedData as any)?.birdeye?.holder !== null && (combinedData as any)?.birdeye?.holder !== undefined
            ? (combinedData as any).birdeye.holder
            : (heliusData?.holderCount !== null && heliusData?.holderCount !== undefined 
              ? heliusData.holderCount 
              : (combinedData?.gmgn?.holders !== null && combinedData?.gmgn?.holders !== undefined
                ? combinedData.gmgn.holders
                : null)),
          topHolders: (heliusData?.topHolders || combinedData?.gmgn?.topHolders || []).slice(0, 10).map((h: any) => ({
            address: h.address || h.id,
            balance: Number(h.balance || 0),
            percentage: Number(h.percentage || 0),
          })),
        },
        developer: {
          creatorAddress: bearTreeData?.creatorAddress || combinedData?.gmgn?.creator?.address || null,
          creatorBalance: Number(bearTreeData?.creatorBalance || combinedData?.gmgn?.creator?.balance || 0),
          creatorStatus: bearTreeData?.creatorStatus || combinedData?.gmgn?.creator?.status || 'unknown',
          top10HolderRate: Number(bearTreeData?.top10HolderRate || gmgnData?.top10HolderRate || 0),
          twitterCreateTokenCount: bearTreeData?.twitterCreateTokenCount || 0,
        },
        trading: {
          price: Number(pair?.priceUsd || combinedData?.gmgn?.price || 0),
          priceChange1m: Number(pair?.priceChange?.m5 || 0), // DexScreener provides m5 (5min), using as 1m approximation
          priceChange5m: Number(pair?.priceChange?.m5 || 0),
          priceChange1h: Number(pair?.priceChange?.h1 || 0),
          priceChange24h: Number(pair?.priceChange?.h24 || 0),
          volume24h: Number(pair?.volume?.h24 || combinedData?.gmgn?.volume24h || 0),
          buys24h: Number(pair?.txns?.h24?.buys || 0),
          sells24h: Number(pair?.txns?.h24?.sells || 0),
          liquidity: Number(pair?.liquidity?.usd || combinedData?.gmgn?.liquidity || 0),
          fdv: Number(pair?.fdv || combinedData?.gmgn?.marketCap || 0),
          marketCap: Number(pair?.marketCap || pair?.fdv || combinedData?.gmgn?.marketCap || 0),
          holderCount: heliusData?.holderCount !== null && heliusData?.holderCount !== undefined
            ? heliusData.holderCount
            : (combinedData?.gmgn?.holders !== null && combinedData?.gmgn?.holders !== undefined
              ? combinedData.gmgn.holders
              : null),
        },
        tokenAge: Math.max(0, tokenAge),
        topTraders: (gmgnData?.topTraders || []) as any[],
      };

      // Feature flag: Use backend risk scoring if enabled (fallback while n8n connectivity is fixed)
      const useBackendRiskScoring = this.configService.get('USE_BACKEND_RISK_SCORING', 'true') === 'true';
      
      if (useBackendRiskScoring) {
        // Calculate risk score directly in backend (matches n8n algorithm exactly)
        this.logger.log(`🧮 Calculating risk score in backend for ${contractAddress}`);
        
        try {
          const vettingData: TokenVettingData = {
            contractAddress: payload.contractAddress,
            chain: payload.chain,
            tokenInfo: payload.tokenInfo,
            security: payload.security,
            holders: payload.holders,
            developer: payload.developer,
            trading: payload.trading,
            tokenAge: payload.tokenAge,
          };

          const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(vettingData);

          // Save to database (matching n8n workflow format)
          await this.repo.saveVettingResults({
            contractAddress,
            chain: chain.toUpperCase() as any,
            name: payload.tokenInfo.name,
            symbol: payload.tokenInfo.symbol,
            holders: payload.holders.count ?? null, // Preserve null for missing data
            age: `${payload.tokenAge} days`,
            imageUrl: payload.tokenInfo.image,
            tokenAge: payload.tokenAge,
            vettingResults,
            launchAnalysis: {
              creatorAddress: payload.developer.creatorAddress,
              creatorBalance: payload.developer.creatorBalance,
              creatorStatus: payload.developer.creatorStatus,
              creatorTokenCount: payload.developer.twitterCreateTokenCount,
              top10HolderRate: payload.developer.top10HolderRate,
            },
            lpData: {
              lpLockPercentage: payload.security.lpLockPercentage,
              lpBurned: payload.security.lpLocks?.some((lock: any) => lock.tag === 'Burned') || false,
              lpLocked: payload.security.lpLockPercentage > 0,
              totalLiquidityUsd: payload.trading.liquidity,
              lockDetails: payload.security.lpLocks || [],
            },
            topHolders: payload.holders.topHolders,
          });

          this.logger.log(`✅ Successfully calculated and saved risk score for ${contractAddress}: ${vettingResults.overallScore} (${vettingResults.riskLevel})`);
        } catch (error: any) {
          this.logger.error(`❌ Error calculating risk score in backend for ${contractAddress}: ${error.message}`);
        }
      } else {
        // Use n8n webhook (original flow)
        this.logger.log(`📤 Sending complete data payload to n8n for ${contractAddress}`);
        const result = await this.n8nService.triggerInitialVetting(payload);
        
        if (result.success) {
          this.logger.log(`✅ Successfully triggered n8n vetting for new token: ${contractAddress}`);
        } else {
          this.logger.warn(`⚠️ Failed to trigger n8n vetting for ${contractAddress}: ${result.error}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`❌ Error triggering vetting for ${contractAddress}: ${error.message}`);
    }
  }

  /**
   * Fetch data from Helius RPC API
   */
  private async fetchHeliusData(contractAddress: string) {
    if (!this.httpService || !this.configService) return null;
    
    try {
      const heliusApiKey = this.configService.get('HELIUS_API_KEY', '1485e891-c87d-40e1-8850-a578511c4b92');
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

      const [assetResponse, holdersResponse] = await Promise.allSettled([
        firstValueFrom(
          this.httpService.post(heliusUrl, {
            jsonrpc: '2.0',
            id: 1,
            method: 'getAsset',
            params: { id: contractAddress },
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          })
        ),
        firstValueFrom(
          this.httpService.post(heliusUrl, {
            jsonrpc: '2.0',
            id: 2,
            method: 'getTokenLargestAccounts',
            params: [contractAddress, { commitment: 'finalized' }],
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          })
        ),
      ]);

      const assetData = assetResponse.status === 'fulfilled' ? assetResponse.value.data : null;
      const holdersData = holdersResponse.status === 'fulfilled' ? holdersResponse.value.data : null;

      const asset = assetData?.result;
      const holders = holdersData?.result?.value || [];

      const totalSupply = asset?.token_info?.supply || 0;
      const topHolders = holders.slice(0, 10).map((h: any) => {
        const balance = Number(h.uiAmount || 0);
        const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
        return {
          address: h.address,
          balance,
          percentage,
        };
      });

      // Get actual holder count from AnalyticsService (not from token accounts length)
      // getTokenLargestAccounts only returns top 10 token accounts, not total holders
      let holderCount: number | null = null;
      try {
        holderCount = await this.analyticsService.getHolderCount(contractAddress, 'SOLANA');
        if (holderCount !== null && holderCount > 0) {
          this.logger.debug(`✅ Fetched holder count for ${contractAddress}: ${holderCount}`);
        } else {
          this.logger.warn(`⚠️ Holder count unavailable for ${contractAddress} (returned: ${holderCount})`);
        }
      } catch (error) {
        this.logger.warn(`❌ Could not fetch holder count for ${contractAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }

      return {
        isMintable: asset?.token_info?.supply_authority !== null,
        isFreezable: asset?.token_info?.freeze_authority !== null,
        totalSupply: Number(asset?.token_info?.supply || 0),
        circulatingSupply: Number(asset?.token_info?.supply || 0),
        holderCount: holderCount ?? null, // Use null instead of 0 to indicate missing data (scoring will handle it)
        topHolders,
        creationTimestamp: asset?.content?.metadata?.created_at || null,
      };
    } catch (error: any) {
      this.logger.warn(`Helius API fetch failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch data from Alchemy API
   */
  private async fetchAlchemyData(contractAddress: string) {
    if (!this.httpService || !this.configService) return null;
    
    try {
      const alchemyApiKey = this.configService.get('ALCHEMY_API_KEY', 'bSSmYhMZK2oYWgB2aMzA_');
      const alchemyUrl = `https://solana-mainnet.g.alchemy.com/v2/${alchemyApiKey}`;

      const response = await firstValueFrom(
        this.httpService.post(alchemyUrl, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [
            contractAddress,
            { encoding: 'jsonParsed' },
          ],
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        })
      );

      const data = response.data;
      const accountInfo = data?.result?.value?.data?.parsed?.info;

      if (!accountInfo) return null;

      return {
        isMintable: accountInfo.mintAuthority !== null,
        isFreezable: accountInfo.freezeAuthority !== null,
        totalSupply: Number(accountInfo.supply || 0),
      };
    } catch (error: any) {
      this.logger.warn(`Alchemy API fetch failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch data from Helius BearTree API
   */
  private async fetchHeliusBearTreeData(contractAddress: string) {
    if (!this.httpService || !this.configService) return null;
    
    try {
      const bearTreeApiKey = this.configService.get('HELIUS_BEARTREE_API_KEY', '99b6e8db-d86a-4d3d-a5ee-88afa8015074');
      const bearTreeUrl = `https://api.helius.xyz/v0/token-metadata?api-key=${bearTreeApiKey}`;

      const response = await firstValueFrom(
        this.httpService.post(bearTreeUrl, {
          mintAccounts: [contractAddress],
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        })
      );

      const data = response.data;
      const tokenData = data?.[0];

      if (!tokenData) return null;

      return {
        creatorAddress: tokenData?.onChainMetadata?.metadata?.updateAuthority || null,
        creatorBalance: 0,
        creatorStatus: 'unknown',
        top10HolderRate: 0,
        twitterCreateTokenCount: 0,
        lpLockPercentage: 0,
        lpLocks: [],
      };
    } catch (error: any) {
      this.logger.warn(`Helius BearTree API fetch failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  }
}