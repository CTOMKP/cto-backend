import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  // Initial tokens - The first set of tokens manually added to the database
  // Initial tokens: These tokens are ensured to exist on startup (if missing, they're re-added)
  // Other tokens can be added via the API endpoint and will join this list
  private readonly INITIAL_TOKENS = [
    { address: 'gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6', chain: 'SOLANA', symbol: 'Michi' },
    { address: '0x660b571d34b91bc4c2fffbf8957ad50b5fac56f4', chain: 'BSC', symbol: 'VINU' },
    { address: '424kbbjyt6vksn7gekt9vh5yetutr1sbeyoya2nmbjpw', chain: 'SOLANA', symbol: 'SIGMA' },
    { address: 'hypxcaat9ybu7vya5burgprsa23hmvdqxt5udsgqwdc', chain: 'SOLANA', symbol: 'Mini' },
    { address: '0x5c6919b79fac1c3555675ae59a9ac2484f3972f5', chain: 'ETHEREUM', symbol: '$HOPPY' },
    { address: '0xfcc89a1f250d76de198767d33e1ca9138a7fb54b', chain: 'BASE', symbol: 'Mochi' },
    { address: '4fp4synbkisczqkwufpkcsxwfdbsvmktsnpbnlplyu9q', chain: 'SOLANA', symbol: 'snoofi' },
    { address: '5ffoyq4q8qxek4v3da x64ir7yuwsxxrjy2qxduet1st', chain: 'SOLANA', symbol: 'Kieth' },
    { address: '0x84196ac042ddb84137e15d1c3ff187adad61f811', chain: 'BSC', symbol: 'LCAT' },
    { address: '2bjky9pnytdvmpdhjhv8qbweykilzebd7i2tatyjxaze', chain: 'SOLANA', symbol: 'HARAMBE' },
    { address: '9uww4c36hictgrufpkwsn7ghrj9vd xktz8na8jv nzqu35pj', chain: 'SOLANA', symbol: 'BILLY' },
    { address: '0x184fb097196a4e2be8dfd44b341cb7d13b41ea7e', chain: 'ETHEREUM', symbol: 'BOOP' },
    { address: 'bszedbevwrqvksaf558eppwpwcm16avepyhm2hgsq9wzyy', chain: 'SOLANA', symbol: 'SC' },
    { address: '0xd6df608d847ad85375fcf1783f8ccd57be6a16d2', chain: 'BSC', symbol: 'LUFFY' },
    { address: '0xbd85f61a1b755b6034c62f16938d6da7c85941705d9d10aa1843b809b0e35582', chain: 'SUI', symbol: 'FUD' },
    { address: 'bduggvl2ylc41bhxmzevh3zjjz69svcx6lhwfy4b71mo', chain: 'SOLANA', symbol: 'VIBE' },
    { address: '35jzmqqc6ewrw6pefwdlhmtxbkvnc9mxpbes4rbws1ww', chain: 'SOLANA', symbol: 'jam' },
    { address: '0x3c79593e01a7f7fed5d0735b16621e2d52a6bc58', chain: 'BSC', symbol: 'Bob' },
    { address: '0x07f071aa224e2fc2cf03ca2e6558ec6181d66a90', chain: 'BSC', symbol: 'CaptainBNB' },
    { address: '0x58495ea0271d957632415b5494966899a1fa0be3', chain: 'BSC', symbol: 'Donkey' },
    { address: '0xea8b7ed6170e0ea3703dde6b496b065a8ececd7b', chain: 'BASE', symbol: 'Russel' },
    { address: '0x40a372f9ee1989d76ceb8e50941b04468f8551d091fb8a5d7211522e42e60aaf', chain: 'SUI', symbol: 'Blub' },
    { address: '0xb785e6eed355c1f8367c06d2b0cb9303ab167f8359a129bb003891ee54c6fce0', chain: 'SUI', symbol: 'hippo' },
  ];

  private readonly jupiterApiKey: string | null;

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
  ) {
    this.jupiterApiKey = this.configService.get<string>('JUPITER_API_KEY') || null;
  }

  // Removed onModuleInit auto-fetch per user request
  // But we still want to ensure initial tokens are present
  async onModuleInit() {
    this.logger.log('🚀 RefreshWorker initialized. Ensuring initial tokens are present...');
    // Non-blocking call to ensure initial tokens exist
    this.ensureInitialTokensExist().catch(err => {
      this.logger.error(`Error during initial token sync: ${err.message}`);
    });
  }

  enqueue(contract: string | { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' }) {
    this.queue.push(contract as any);
    this.run();
  }

  // REMOVED: Automatic cleanup - Tokens are manually managed, no automatic deletion
  // @Cron('0 */6 * * *') // DISABLED
  async cleanupOldRecords() {
    try {
      this.logger.log('🧹 Starting cleanup of old records...');
      
      // Use the repository's public methods instead of accessing private prisma
      const client = (this.repo as any)['prisma'] as any;
      
      const pinnedAddresses = this.INITIAL_TOKENS.map(t => t.address.toLowerCase());

      // Strict limit: Keep only the latest 25 listings for the "Presentable Model"
      // PLUS any initial tokens that might be outside the top 25
      const listingsToKeep = await client.listing.findMany({
        where: {
          OR: [
            { contractAddress: { in: pinnedAddresses } },
            // also keep the top 25 newest/highest score ones
          ]
        },
        orderBy: { updatedAt: 'desc' },
        take: 50, // Increased buffer to account for initial tokens
        select: { id: true, contractAddress: true }
      });
      
      const listingIds = listingsToKeep.map((l: any) => l.id);
      const deletedListings = await client.listing.deleteMany({
        where: { 
          id: { notIn: listingIds },
          contractAddress: { notIn: pinnedAddresses } // Double safety
        }
      });
      
      // Also cleanup old scans to match
      const keptAddresses = listingsToKeep.map((l: any) => l.contractAddress);
      const deletedScans = await client.scanResult.deleteMany({
        where: { 
          contractAddress: { 
            notIn: [...keptAddresses, ...pinnedAddresses] 
          } 
        }
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
  // PILLAR 1: Process unvetted tokens (vetting/risk scoring)
  // Runs at :05, :15, :25, :35, :45, :55 every hour (every 10 minutes, offset by 5 min from discovery)
  @Cron('5,15,25,35,45,55 * * * *', {
    name: 'pillar1-vet-tokens',
    timeZone: 'UTC',
  })
  async processExistingUnvettedTokens() {
    this.logger.log('🔄 [PILLAR 1] Starting processExistingUnvettedTokens cron job (vetting)...');
    
    try {
      const client = (this.repo as any)['prisma'] as any;
      // Get tokens that haven't been vetted (Pillar 1) - query unvetted tokens only
      const unvettedTokens = await client.listing.findMany({
        where: {
          OR: [
            { vetted: false },
            { riskScore: null },
          ],
          chain: 'SOLANA', // Only process SOLANA tokens for now
        },
        take: 20, // Process 20 at a time
        orderBy: { createdAt: 'asc' }, // Process oldest first
      });

      if (unvettedTokens.length === 0) {
        this.logger.debug('No unvetted tokens found');
        return;
      }

      this.logger.log(`📋 Processing ${unvettedTokens.length} unvetted tokens with backend risk scoring...`);

      for (const token of unvettedTokens) {
        try {
          this.logger.log(`🔄 Triggering vetting for token ${token.contractAddress} (chain: ${token.chain})`);
          await this.triggerN8nVettingForNewToken(token.contractAddress, token.chain.toLowerCase());
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

  // DISABLED: Token discovery from feeds - Tokens are now manually added via API
  // Cron job disabled - tokens should be added using POST /api/listing/add endpoint
  // @Cron('0 */10 * * * *') // DISABLED - Manual token addition only
  async scheduledFetchFeed() {
    // DISABLED - This method is no longer used
    // Tokens should be added manually via POST /api/listing/add
    this.logger.warn('⚠️ scheduledFetchFeed() called but is disabled - tokens should be added manually via POST /api/listing/add');
    return;
  }

  private async getDexScreenerFeed() {
    const key = this.cache.cacheKey('feed:dex', { chains: 'all' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Fetch multiple search queries to scale results beyond 300 pairs.
    // Deduplicate by baseToken.address or pairAddress.
    const queries = [
      // Solana (High volume/Established)
      'sol trending', 'sol top', 'sol jupiter', 'sol raydium', 'sol usdc', 'sol moon', 'sol pump',
      'sol pepe', 'sol doge', 'sol cat', 'sol dexscreener', 'sol volume', 'sol liquid',
      // Ethereum
      'eth trending', 'eth uniswap', 'eth volume',
      // BSC
      'bsc trending', 'bsc pancakeswap',
      // Base
      'base trending', 'base uniswap',
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

  /**
   * Verify if a Solana address is a valid mint using Jupiter API
   * Returns true if the address is a valid mint, false otherwise
   */
  private async verifyMintWithJupiter(mintAddress: string): Promise<boolean> {
    if (!this.jupiterApiKey || !this.isSolanaMint(mintAddress)) {
      return false;
    }

    try {
      const url = `https://api.jup.ag/tokens/v2/mints?ids=${mintAddress}`;
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'x-api-key': this.jupiterApiKey,
            'accept': 'application/json',
          },
          timeout: 5000,
        })
      );

      // Jupiter returns an array - if it has data for this mint, it's valid
      return Array.isArray(response.data) && response.data.length > 0 && response.data[0]?.address === mintAddress;
    } catch (error: any) {
      this.logger.debug(`Jupiter mint verification failed for ${mintAddress}: ${error.message}`);
      return false;
    }
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
    
    // ... (logic remains same)
    for (const feed of feeds) {
      if (!feed) continue;

      // DexScreener shape: { pairs: [...] }
      if (Array.isArray(feed.pairs)) {
        for (const p of feed.pairs.slice(0, 800)) { // Increased slice to find more mature tokens
          // FIX: Correctly identify the "target" token in the pair
          // Usually baseToken is the meme, and quoteToken is SOL/USDC.
          // But sometimes it's reversed.
          let base = p?.baseToken || {};
          let quote = p?.quoteToken || {};
          
          let address = base?.address;
          let symbol = base?.symbol;
          let name = base?.name;

          // If the base is SOL/WSOL/USDC/MOVE, swap to the other side to get the actual token
          const isBaseNative = symbol === 'SOL' || symbol === 'WSOL' || symbol === 'USDC' || symbol === 'MOVE';
          if (isBaseNative && quote?.address) {
            address = quote.address;
            symbol = quote.symbol;
            name = quote.name;
          }

          const chainEnum = this.mapChainIdToEnum(p?.chainId);
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          // DEDUPE: If we already have this token from a better pool, skip it
          if (byKey.has(key)) {
            const existing = byKey.get(key);
            const currentLiq = Number(p?.liquidity?.usd || 0);
            const existingLiq = Number(existing.market?.liquidityUsd || 0);
            if (currentLiq <= existingLiq) continue; 
          }

          // Prefer only valid numeric market fields and presence of txns
          const priceUsdNum = Number(p?.priceUsd);
          const liquidityUsdNum = Number(p?.liquidity?.usd);
          const volumeH24Num = Number(p?.volume?.h24);
          const txns = p?.txns || null;
          
          const market = {
            priceUsd: priceUsdNum,
            liquidityUsd: liquidityUsdNum,
            fdv: Number.isFinite(Number(p?.fdv)) ? Number(p?.fdv) : null,
            priceChange: {
              m5: Number.isFinite(Number((p as any)?.priceChange?.m5)) ? Number((p as any)?.priceChange?.m5) : null,
              h1: Number.isFinite(Number((p as any)?.priceChange?.h1)) ? Number((p as any)?.priceChange?.h1) : null,
              h6: Number.isFinite(Number((p as any)?.priceChange?.h6)) ? Number((p as any)?.priceChange?.h6) : null,
              h24: Number.isFinite(Number((p as any)?.priceChange?.h24)) ? Number((p as any)?.priceChange?.h24) : null,
            },
            volume: { h24: volumeH24Num },
            txns,
            pairAddress: p?.pairAddress || null,
            chainId: p?.chainId || null,
            source: 'dexscreener',
            holders: null,
          };
          const logoUrl = p?.info?.imageUrl || base?.imageUrl || base?.logoURI || null;
          byKey.set(key, { chain: chainEnum, address, symbol, name, market, logoUrl });
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
      const pinnedAddresses = this.INITIAL_TOKENS.map(t => t.address);
      
      // Get total count (excluding pinned)
      const nonPinnedCount = await client.listing.count({
        where: { contractAddress: { notIn: pinnedAddresses } }
      });
      
      this.logger.log(`📊 Current non-initial token count: ${nonPinnedCount}`);
      
      // Limit to 25 non-initial tokens
      if (nonPinnedCount <= 25) {
        return;
      }
      
      const tokensToRemove = nonPinnedCount - 25;
      
      // Remove the oldest non-initial tokens
      const tokensToDelete = await client.listing.findMany({
        where: { contractAddress: { notIn: pinnedAddresses } },
        orderBy: [
          { riskScore: 'asc' }, 
          { createdAt: 'asc' }  
        ],
        take: tokensToRemove,
        select: { id: true }
      });
      
      if (tokensToDelete.length > 0) {
        const idsToDelete = tokensToDelete.map((t: any) => t.id);
        await client.listing.deleteMany({
          where: { id: { in: idsToDelete } }
        });
        
        this.logger.log(`🗑️ Rotation: Removed ${tokensToDelete.length} non-initial tokens.`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error enforcing token limit: ${error.message}`);
    }
  }

  private async upsertFromMerged(items: any[]) {
    const deltas = { new: [] as any[], updated: [] as any[] };
    if (!Array.isArray(items) || !items.length) return deltas;
    
    // Filter: Only include tokens older than 14 days OR native coins (SOL, MOVE, USDC)
    const filteredItems = items.filter(x => {
      const symbol = x.symbol?.toUpperCase();
      const name = x.name?.toUpperCase();
      const address = x.address;
      const age = x.market?.age;
      
      // Strict blacklist for base tokens appearing as memes
      const isNative = symbol === 'SOL' || symbol === 'WSOL' || symbol === 'USDC' || symbol === 'MOVE' || 
                       name?.includes('WRAPPED SOL') || name?.includes('USD COIN');
      
      // If it's a native token, we only allow it if it's the "Official" one
      const officialAddresses = [
        'So11111111111111111111111111111111111111112', // WSOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        '0x1::aptos_coin::AptosCoin', // MOVE
      ];
      
      const isOfficialNative = officialAddresses.includes(address);
      if (isNative && !isOfficialNative) return false; // Filter out "fake" or "pool" versions of SOL/USDC
      
      const isPinned = this.INITIAL_TOKENS.some(t => t.address.toLowerCase() === address.toLowerCase());

      // If age is null, we'll let it through to the vetting process where it might be deleted
      return isOfficialNative || isPinned || age === null || age >= 14; 
    });

    // REMOVED: Token limit - No limits with manual token management
    // Sort by Volume + Liquidity for ordering, but don't limit
    const sortedItems = filteredItems
      .sort((a, b) => {
        const aVolume = Number(a.market?.volume?.h24 ?? 0);
        const bVolume = Number(b.market?.volume?.h24 ?? 0);
        const aLiquidity = Number(a.market?.liquidityUsd ?? 0);
        const bLiquidity = Number(b.market?.liquidityUsd ?? 0);
        return (bVolume + bLiquidity) - (aVolume + aLiquidity);
      });
    
    this.logger.log(`🎯 Populating database with top ${sortedItems.length} candidate tokens`);

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
        
        // Ensure all required fields from reference images are included
        const marketData = {
          ...(x.market ?? {}),
          category,
          logoUrl: resolvedLogo ?? null,
          // Ensure these fields are always present
          holders: x.market?.holders ?? null,
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
          // Only trigger vetting for NEW unvetted tokens (Pillar 1)
          // Check if token is unvetted (vetted = false OR riskScore IS NULL)
          if ((after?.vetted === false || after?.riskScore === null) && this.n8nService && this.externalApisService) {
            this.triggerN8nVettingForNewToken(address, chain).catch((error) => {
              this.logger.warn(`Failed to trigger vetting for new token ${address}: ${error.message}`);
            });
          } else if (after?.vetted === false || after?.riskScore === null) {
            // If n8n service not available, log warning
            this.logger.warn(`⚠️ New token ${address} created but vetting services not available - tier will remain null`);
          }
        } else {
          // For existing tokens, only trigger vetting if they haven't been vetted (Pillar 1)
          if ((after?.vetted === false || (after?.riskScore === null && after?.vetted !== true)) && this.n8nService && this.externalApisService) {
            this.triggerN8nVettingForNewToken(address, chain).catch((error) => {
              this.logger.warn(`Failed to trigger vetting for existing unvetted token ${address}: ${error.message}`);
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

  // REMOVED: Daily rotation - Tokens are manually managed, no automatic deletion
  // @Cron('0 0 * * *') // DISABLED
  async dailyRotation() {
    try {
      this.logger.log('🌅 Starting Daily Rotation: Clearing database for fresh tokens (except pinned)...');
      const client = (this.repo as any)['prisma'] as any;
      const pinnedAddresses = this.INITIAL_TOKENS.map(t => t.address);
      
      const deletedListings = await client.listing.deleteMany({
        where: { contractAddress: { notIn: pinnedAddresses } }
      });
      const deletedScans = await client.scanResult.deleteMany({
        where: { contractAddress: { notIn: pinnedAddresses } }
      });
      
      this.logger.log(`✅ Daily Rotation Complete: Deleted ${deletedListings.count} listings and ${deletedScans.count} scans.`);
      
      // Re-fetch initial tokens to ensure they are up to date
      await this.ensureInitialTokensExist();

      // Immediately trigger multiple fetches to ensure we find enough mature tokens
      for (let i = 0; i < 3; i++) {
        await this.scheduledFetchFeed();
        if (i < 2) await new Promise(resolve => setTimeout(resolve, 5000)); // Short gap
      }
    } catch (error: any) {
      this.logger.error('❌ Daily Rotation failed:', error);
    }
  }

  /**
   * Specifically fetch and ensure the initial tokens are in the database.
   * This bypasses the normal filtering/limiting logic to guarantee initial tokens are saved.
   */
  async ensureInitialTokensExist() {
    this.logger.log('📍 Checking initial tokens and holder data...');
    let injectedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    for (const t of this.INITIAL_TOKENS) {
      try {
        // Check if already exists - try by address first, then by symbol+chain
        let existing = await this.repo.findOne(t.address);
        if (!existing && t.symbol) {
          existing = await this.repo.findBySymbolAndChain(t.symbol, t.chain as any);
        }
        if (existing) {
          const chain = t.chain as 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN';
          
          // FIX: For Solana INITIAL_TOKENS, if the stored address doesn't match INITIAL_TOKENS address,
          // delete the old record and recreate with correct address (pair address bug fix)
          if (chain === 'SOLANA' && this.isSolanaMint(t.address) && t.address.toLowerCase() !== existing.contractAddress.toLowerCase()) {
            this.logger.log(`🔧 Address mismatch detected for ${t.symbol}: stored=${existing.contractAddress}, INITIAL_TOKENS=${t.address}`);
            this.logger.log(`🗑️ Deleting old record with pair address to recreate with correct mint address...`);
            const client = (this.repo as any)['prisma'] as any;
            await client.listing.delete({ where: { id: existing.id } });
            this.logger.log(`✅ Deleted old record, will recreate with correct mint address`);
            // Continue to the "missing" branch to recreate with correct address
            existing = null;
          }
          
          if (existing) {
            // If token exists but has no holder data, fetch and update it
            if (existing.holders === null || existing.holders === undefined) {
              this.logger.log(`🔍 Initial token ${t.symbol} (${t.address}) exists but missing holder data, fetching...`);
              
              // Use INITIAL_TOKENS address for Solana tokens (we trust it's correct)
              const address = (chain === 'SOLANA' && this.isSolanaMint(t.address)) ? t.address : existing.contractAddress;
              
              // Fetch holder count
              let holdersNum = null;
              try {
                const holderCount = await this.analyticsService.getHolderCount(address, chain);
                if (holderCount !== null && holderCount > 0) {
                  holdersNum = holderCount;
                  this.logger.log(`✅ Fetched ${holdersNum} holders for existing initial token ${t.symbol} (${address})`);
                } else {
                  this.logger.warn(`⚠️ getHolderCount returned null/0 for existing initial token ${t.symbol} (${address}) on ${chain}`);
                }
              } catch (holderError: any) {
                this.logger.warn(`⚠️ Could not fetch holder count for existing initial token ${t.symbol}: ${holderError.message}`);
              }
              
              // Update only the holder data
              if (holdersNum !== null) {
                await this.repo.upsertMarketMetadata({
                  contractAddress: existing.contractAddress, // Use existing address for update
                  chain: existing.chain,
                  symbol: existing.symbol,
                  name: existing.name,
                  market: {
                    holders: holdersNum,
                    // Preserve existing market data
                    priceUsd: existing.priceUsd ?? 0,
                    liquidityUsd: existing.liquidityUsd ?? 0,
                    volume: existing.volume ?? { h24: 0 },
                    priceChange: existing.priceChange ?? { m5: null, h1: null, h6: null, h24: null },
                    riskScore: existing.riskScore,
                    communityScore: existing.communityScore,
                    age: existing.age,
                    lastUpdated: Date.now()
                  },
                });
                this.logger.log(`✅ Updated holder data for initial token ${t.symbol} (${existing.contractAddress}): ${holdersNum} holders`);
                updatedCount++;
              } else {
                this.logger.warn(`⚠️ Could not fetch holder data for existing initial token ${t.symbol} (${existing.contractAddress}) - keeping as null`);
                skippedCount++;
              }
              
              // Add delay between tokens to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            } else {
              skippedCount++;
              continue;
            }
          }
          // If existing was deleted, fall through to recreate with correct address
        }

        this.logger.log(`🔍 Initial token ${t.symbol} (${t.address}) missing, fetching data...`);
        
        // Try fetching as TOKEN first
        const tokenUrl = `https://api.dexscreener.com/latest/dex/tokens/${t.address}`;
        let res = await axios.get(tokenUrl, { timeout: 8000 });
        
        // If no pairs found, try fetching as PAIR (in case user provided a pair address)
        if (!res.data?.pairs || res.data.pairs.length === 0) {
          const chainId = t.chain.toLowerCase() === 'solana' ? 'solana' : 
                          t.chain.toLowerCase() === 'ethereum' ? 'ethereum' : 
                          t.chain.toLowerCase() === 'bsc' ? 'bsc' : 
                          t.chain.toLowerCase() === 'base' ? 'base' : 
                          t.chain.toLowerCase() === 'sui' ? 'sui' : 'solana';
          const pairUrl = `https://api.dexscreener.com/latest/dex/pairs/${chainId}/${t.address}`;
          res = await axios.get(pairUrl, { timeout: 8000 });
        }

        if (res.data?.pairs && res.data.pairs.length > 0) {
          this.logger.log(`✅ Found DexScreener data for initial token ${t.symbol} (${t.address})`);
          
          // Merge the feed to get structured data
          const merged = this.mergeFeeds([{ pairs: res.data.pairs }]);
          if (!merged || merged.length === 0) {
            this.logger.warn(`⚠️ Merged data empty for initial token ${t.symbol} (${t.address})`);
            continue;
          }
          
          // Get the first (best) pair from merged results
          const tokenData = merged[0];
          if (!tokenData || !tokenData.address) {
            this.logger.warn(`⚠️ Invalid token data structure for initial token ${t.symbol} (${t.address})`);
            continue;
          }
          
          // Directly upsert the initial token (bypassing the volume/liquidity sorting/limiting)
          const chain = t.chain as 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN';
          
          // FIX: Prioritize using the original INITIAL_TOKENS address if it's a valid mint
          // This prevents saving pair addresses instead of mint addresses
          let address = tokenData.address as string;
          if (chain === 'SOLANA' && this.isSolanaMint(t.address)) {
            // Verify the original address is a valid mint using Jupiter
            const isValidMint = await this.verifyMintWithJupiter(t.address);
            if (isValidMint) {
              address = t.address; // Use the original INITIAL_TOKENS address (mint)
              this.logger.log(`✅ Verified original address ${t.address} is a valid mint for ${t.symbol}, using it instead of DexScreener address ${tokenData.address}`);
            } else if (this.isSolanaMint(address)) {
              // Fallback: use DexScreener's address if original is invalid
              this.logger.warn(`⚠️ Original address ${t.address} failed Jupiter validation, using DexScreener address ${address} for ${t.symbol}`);
            }
          }
          
          if (chain === 'SOLANA' && !this.isSolanaMint(address)) {
            this.logger.warn(`⚠️ Invalid Solana mint address for initial token ${t.symbol}: ${address}`);
            continue;
          }
          
          const category = this.classifyCategory(tokenData);
          const resolvedLogo = tokenData.logoUrl || await this.resolveLogoCached(chain, address, tokenData.symbol, tokenData.name);
          
          // Fetch holder count from Birdeye (Solana) or Moralis (other chains)
          let holdersNum = null;
          try {
            const holderCount = await this.analyticsService.getHolderCount(address, chain);
            if (holderCount !== null && holderCount > 0) {
              holdersNum = holderCount;
              this.logger.log(`✅ Fetched ${holdersNum} holders for initial token ${t.symbol} from ${chain === 'SOLANA' ? 'Birdeye' : 'Moralis'}`);
            } else {
              this.logger.warn(`⚠️ getHolderCount returned null/0 for ${t.symbol} (${address}) on ${chain}`);
            }
          } catch (holderError: any) {
            this.logger.warn(`⚠️ Could not fetch holder count for ${t.symbol}: ${holderError.message}`);
          }
          
          // Fallback to merged data if API fetch failed
          if (holdersNum === null && tokenData.market?.holders !== undefined && tokenData.market?.holders !== null) {
            const parsed = parseInt(tokenData.market.holders.toString(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              holdersNum = parsed;
              this.logger.log(`✅ Using fallback holder count from DexScreener: ${holdersNum} for ${t.symbol}`);
            }
          }
          
          // Log final holder value before saving
          if (holdersNum === null) {
            this.logger.warn(`⚠️ No holder data available for ${t.symbol} (${address}) - will save as null`);
          }
          
          const marketData = {
            ...(tokenData.market ?? {}),
            category,
            logoUrl: resolvedLogo ?? null,
            holders: holdersNum,
            priceUsd: tokenData.market?.priceUsd ?? 0,
            liquidityUsd: tokenData.market?.liquidityUsd ?? 0,
            fdv: tokenData.market?.fdv ?? 0,
            volume: tokenData.market?.volume ?? { h24: 0 },
            priceChange: tokenData.market?.priceChange ?? { m5: null, h1: null, h6: null, h24: null },
            riskScore: tokenData.market?.riskScore ?? null,
            communityScore: tokenData.market?.communityScore ?? null,
            age: tokenData.market?.age ?? null,
            lastUpdated: Date.now()
          };
          
          await this.repo.upsertMarketMetadata({
            contractAddress: address,
            chain,
            symbol: tokenData.symbol ?? t.symbol ?? null,
            name: tokenData.name ?? null,
            market: marketData,
          });
          
          this.logger.log(`✅ Successfully saved initial token ${t.symbol} (${address}) to database`);
          injectedCount++;
          
          // Trigger vetting if token hasn't been vetted (Pillar 1)
          const saved = await this.repo.findOne(address);
          if (saved && (saved.vetted === false || saved.riskScore === null) && this.n8nService && this.externalApisService) {
            this.triggerN8nVettingForNewToken(address, chain).catch((error) => {
              this.logger.warn(`Failed to trigger vetting for initial token ${t.symbol}: ${error.message}`);
            });
          }
        } else {
          this.logger.warn(`❌ Could not find DexScreener data for initial token ${t.symbol} (${t.address}) as token OR pair`);
        }
      } catch (e: any) {
        this.logger.error(`❌ Error ensuring initial token ${t.symbol} (${t.address}): ${e.message}`);
        if (e.stack) {
          this.logger.error(`Stack trace: ${e.stack}`);
        }
      }
      
      // Add delay between tokens to avoid rate limiting (Birdeye free tier = 60 RPM = 1 req/sec)
      // Using 2 seconds to account for multiple processes running simultaneously
      // Note: delay already applied for updated tokens before continue, so this mainly applies to new tokens
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    }
    this.logger.log(`📍 Initial tokens check complete. Injected: ${injectedCount}, Updated (holder data): ${updatedCount}, Already existed (complete): ${skippedCount}, Total: ${this.INITIAL_TOKENS.length}`);
  }

  // REMOVED: Token limit enforcement - No limits with manual token management
  // @Cron('0 0 */6 * * *') // DISABLED
  async enforceTokenLimitRotation() {
    // DISABLED - No token limits with manual management
  }

  // REMOVED: scheduledRefreshAll - This was re-vetting all tokens, which is Pillar 2's job.
  // Pillar 1 (processExistingUnvettedTokens) only processes unvetted tokens.
  // Pillar 2 (CronService.handleTokenMonitoring) handles monitoring/re-vetting of all vetted tokens.

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
          count: combinedData?.gmgn?.holders || heliusData?.holderCount || 0,
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

          // STRICT FILTER: If the token is found to be < 14 days during vetting, 
          // we do NOT save it to the public listing to keep the model presentable.
          const isNative = payload.tokenInfo.symbol === 'SOL' || payload.tokenInfo.symbol === 'MOVE' || payload.tokenInfo.symbol === 'USDC';
          const isPinned = this.INITIAL_TOKENS.some(t => t.address.toLowerCase() === contractAddress.toLowerCase());

          if (isNative || isPinned) {
            if (isNative) payload.tokenAge = 365; // Force native coins to appear mature
            this.logger.log(`📍 Pinned or Native token ${contractAddress} detected. Bypassing age check.`);
            // Proceed with saving
          } else if (payload.tokenAge < 14) {
            this.logger.log(`⚠️ Token ${contractAddress} is too young (${payload.tokenAge} days). Skipping public listing.`);
            // If it was already in the DB from the initial feed, remove it
            const client = (this.repo as any)['prisma'] as any;
            await client.listing.delete({ where: { contractAddress } }).catch(() => {});
            return;
          }

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

      // Get actual holder count (getTokenLargestAccounts only returns top 10 token accounts)
      return {
        isMintable: asset?.token_info?.supply_authority !== null,
        isFreezable: asset?.token_info?.freeze_authority !== null,
        totalSupply: Number(asset?.token_info?.supply || 0),
        circulatingSupply: Number(asset?.token_info?.supply || 0),
        holderCount: null, // Resetting to null as requested to undo changes
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