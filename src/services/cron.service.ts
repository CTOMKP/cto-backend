import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalApisService } from './external-apis.service';
import { N8nService } from './n8n.service';
import { TokenImageService } from './token-image.service';
import { Pillar1RiskScoringService, TokenVettingData } from './pillar1-risk-scoring.service';
import { Pillar2MonitoringService } from './pillar2-monitoring.service';
import { TokenValidatorUtil } from '../utils/token-validator.util';
import { Chain, Listing } from '@prisma/client';
import { ListingRepository } from '../listing/repository/listing.repository';
import { AnalyticsService } from '../listing/services/analytics.service';

@Injectable()
export class CronService implements OnModuleInit {
  private readonly logger = new Logger(CronService.name);
  private recalculationTriggered = false;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private externalApisService: ExternalApisService,
    private n8nService: N8nService,
    private tokenImageService: TokenImageService,
    private pillar1RiskScoringService: Pillar1RiskScoringService,
    private pillar2MonitoringService: Pillar2MonitoringService,
    private listingRepository: ListingRepository,
    private httpService: HttpService,
    private analyticsService: AnalyticsService,
  ) {}

  /**
   * Lifecycle hook: Runs automatically when module is initialized
   * Triggers risk score recalculation for existing tokens on first startup
   */
  async onModuleInit() {
    // Wait a bit for database connections to be ready
    await this.delay(5000);

    // REMOVED: Startup recalculation - This was causing duplicate processing with Pillar 1
    // Pillar 1 (RefreshWorker) handles initial vetting of new tokens
    // Pillar 2 (handleTokenMonitoring) handles periodic monitoring/re-vetting of all vetted tokens
    this.logger.log('ℹ️ CronService initialized - Pillar 2 monitoring will run on schedule');
  }

  /**
   * Map chain string to Prisma Chain enum
   */
  private mapChainToPrismaEnum(chain: string): Chain {
    const chainMap: Record<string, Chain> = {
      'solana': Chain.SOLANA,
      'ethereum': Chain.ETHEREUM,
      'bsc': Chain.BSC,
      'base': Chain.BASE,
      'polygon': Chain.OTHER, // Map to OTHER for now
      'arbitrum': Chain.OTHER,
      'avalanche': Chain.OTHER,
      'optimism': Chain.OTHER,
    };
    return chainMap[chain.toLowerCase()] || Chain.UNKNOWN;
  }

  // REMOVED: handleTokenDiscovery - This was redundant with RefreshWorker.scheduledFetchFeed (Pillar 1)
  // Token discovery is handled by RefreshWorker (Pillar 1)
  // CronService (Pillar 2) only handles monitoring of already-vetted tokens

  /**
   * PILLAR 2: Token Monitoring Cron Job
   * Runs every 30 minutes to monitor existing vetted tokens
   * Runs at :00 and :30 every hour (offset from Pillar 1 to avoid conflicts)
   */
  @Cron('0,30 * * * *', {
    name: 'pillar2-token-monitoring',
    timeZone: 'UTC',
  })
  async handleTokenMonitoring() {
    const isEnabled = this.configService.get('TOKEN_MONITORING_ENABLED', 'true') === 'true';
    
    if (!isEnabled) {
      this.logger.debug('Token monitoring cron job is disabled');
      return;
    }

    this.logger.log('Starting token monitoring cron job');

    try {
      const batchSize = parseInt(this.configService.get('TOKEN_MONITORING_BATCH_SIZE', '100'));
      
      // Get listings that need monitoring
      const listingsToMonitor = await this.getListingsForMonitoring(batchSize);
      
      if (listingsToMonitor.length === 0) {
        this.logger.debug('No listings found for monitoring');
        return;
      }

      this.logger.log(`Monitoring ${listingsToMonitor.length} listings`);

      // Process listings in batches to avoid rate limits
      const batchSizeForProcessing = 10;
      for (let i = 0; i < listingsToMonitor.length; i += batchSizeForProcessing) {
        const batch = listingsToMonitor.slice(i, i + batchSizeForProcessing);
        await this.processMonitoringBatch(batch);
        
        // Add delay between batches to respect rate limits
        if (i + batchSizeForProcessing < listingsToMonitor.length) {
          await this.delay(2000); // 2 seconds delay
        }
      }

      this.logger.log('Token monitoring cron job completed successfully');
    } catch (error) {
      this.logger.error('Token monitoring cron job failed:', error);
    }
  }

  /**
   * Discover tokens for a specific chain
   */
  private async discoverTokensForChain(chain: string, batchSize: number) {
    this.logger.debug(`Discovering tokens for chain: ${chain}`);

    try {
      // Get trending/new tokens from DexScreener
      let trendingTokens = await this.getTrendingTokensFromDexScreener(chain, batchSize);
      
      // If DexScreener fails, try fallback methods
      if (!trendingTokens || trendingTokens.length === 0) {
        this.logger.warn(`No tokens found from DexScreener for chain: ${chain}, trying fallback methods`);
        trendingTokens = await this.getFallbackTokens(chain, batchSize);
      }
      
      if (!trendingTokens || trendingTokens.length === 0) {
        this.logger.warn(`No tokens found for chain: ${chain} from any source`);
        return;
      }

      this.logger.log(`Found ${trendingTokens.length} tokens for ${chain}`);

      // Process each token
      for (const tokenAddress of trendingTokens) {
        try {
          if (!this.isValidAddressForChain(tokenAddress, chain)) {
            this.logger.debug(`[Filter] Skipping invalid or non-${chain} address: ${tokenAddress}`);
            continue;
          }
          await this.processNewToken(tokenAddress, chain);
          await this.delay(1000); // 1 second delay between tokens
        } catch (error: any) {
          this.logger.error(`Failed to process token ${tokenAddress}:`, error.message);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to discover tokens for chain ${chain}:`, error);
    }
  }

  /**
   * Get fallback tokens when DexScreener fails
   * Only returns valid SPL tokens (filters out native tokens)
   */
  private async getFallbackTokens(chain: string, limit: number): Promise<string[]> {
    try {
      // For Solana, use some well-known SPL token addresses as fallback
      // Note: Excluded native tokens (like wrapped SOL) - they don't work with APIs
      if (chain.toLowerCase() === 'solana') {
        const fallbackTokens = [
          // Valid SPL Tokens (NOT native)
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (SPL)
          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT (SPL)
          'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
          'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
          '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH (Wormhole)
          'A94X1fR3W6LrFxXxPp22SbyMpUfWHAfckD8vro5tRhtb', // RAY
          '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // COPE
          '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', // FIDA
          'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
          'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
          'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
          'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
        ];
        
        // Filter to ensure only valid SPL tokens are returned
        const validTokens = TokenValidatorUtil.filterValidSPLTokens(fallbackTokens, chain);
        this.logger.debug(`Using ${validTokens.length} fallback SPL tokens for Solana (filtered from ${fallbackTokens.length} total)`);
        return validTokens.slice(0, limit);
      }

      // For other chains, return empty array for now
      this.logger.debug(`No fallback tokens available for chain: ${chain}`);
      return [];
    } catch (error) {
      this.logger.error('Failed to get fallback tokens:', error);
      return [];
    }
  }

  /**
   * Get trending tokens from DexScreener
   */
  private async getTrendingTokensFromDexScreener(chain: string, limit: number): Promise<string[]> {
    try {
      // Map chain names to DexScreener chain IDs
      const chainMap: Record<string, string> = {
        'solana': 'solana',
        'ethereum': 'ethereum',
        'bsc': 'bsc',
        'base': 'base',
        'polygon': 'polygon',
        'arbitrum': 'arbitrum',
        'avalanche': 'avalanche',
        'optimism': 'optimism',
      };

      const dexScreenerChain = chainMap[chain.toLowerCase()] || chain.toLowerCase();
      
      // Try multiple DexScreener endpoints
      const endpoints = [
        `https://api.dexscreener.com/latest/dex/tokens/trending?chain=${dexScreenerChain}&limit=${limit}`,
        `https://api.dexscreener.com/latest/dex/search/?q=${dexScreenerChain}&limit=${limit}`,
        `https://api.dexscreener.com/latest/dex/tokens/new?chain=${dexScreenerChain}&limit=${limit}`,
      ];

      for (const url of endpoints) {
        try {
          this.logger.debug(`Fetching tokens from DexScreener: ${url}`);
          
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'CTOMarketplace/1.0',
            },
          });

          if (!response.ok) {
            this.logger.warn(`DexScreener API error for ${url}: ${response.status} ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          
          if (data.pairs && Array.isArray(data.pairs) && data.pairs.length > 0) {
            // Extract contract addresses from the pairs
            let contractAddresses = data.pairs
              .filter((pair: any) => pair.baseToken && pair.baseToken.address)
              .map((pair: any) => pair.baseToken.address);
            
            // Filter out native tokens (only keep valid SPL tokens)
            contractAddresses = TokenValidatorUtil.filterValidSPLTokens(contractAddresses, chain);
            
            // Limit to requested batch size
            contractAddresses = contractAddresses.slice(0, limit);

            this.logger.debug(`Found ${contractAddresses.length} valid SPL tokens for ${chain} from ${url} (after filtering)`);
            return contractAddresses;
          }
        } catch (endpointError: any) {
          this.logger.warn(`Failed to fetch from ${url}:`, endpointError.message);
          continue;
        }
      }

      this.logger.warn(`No tokens found from any DexScreener endpoint for chain: ${chain}`);
      return [];
    } catch (error) {
      this.logger.error('Failed to get trending tokens from DexScreener:', error);
      return [];
    }
  }

  /**
   * Fetch all token data from various APIs
   * Combines data from DexScreener, Helius, Alchemy, and Helius BearTree
   */
  private async fetchAllTokenData(contractAddress: string, chain: string) {
    this.logger.debug(`Fetching all data for token: ${contractAddress}`);

    try {
      // Fetch data from multiple sources in parallel
      const [dexScreenerData, combinedData, imageUrl] = await Promise.all([
        this.externalApisService.fetchDexScreenerData(contractAddress, chain),
        this.externalApisService.fetchCombinedTokenData(contractAddress, chain),
        this.tokenImageService.fetchTokenImage(contractAddress, chain),
      ]);

      // Fetch Helius data (token metadata, holders, creation date)
      const heliusData = await this.fetchHeliusData(contractAddress);
      
      // Fetch Alchemy data (if available)
      const alchemyData = await this.fetchAlchemyData(contractAddress);
      
      // Fetch Helius BearTree data (developer info)
      const bearTreeData = await this.fetchHeliusBearTreeData(contractAddress);

      // Extract token info
      // DexScreener returns a single pair object, not an array
      const pair = dexScreenerData || combinedData?.dexScreener;
      const baseToken = (pair?.baseToken || {}) as { name?: string; symbol?: string; decimals?: number };
      const gmgnData = (combinedData?.gmgn as any) || {};
      
      // Calculate token age
      const creationTimestamp = heliusData?.creationTimestamp || pair?.pairCreatedAt;
      // Determine if timestamp is in seconds or milliseconds
      // Timestamps > 1e12 are in milliseconds, < 1e12 are in seconds
      const timestampMs = creationTimestamp 
        ? (creationTimestamp > 1e12 ? creationTimestamp : creationTimestamp * 1000)
        : null;
      const tokenAge = timestampMs 
        ? Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24))
        : 0;

      // Fetch holder count using AnalyticsService (tries Birdeye, CoinGecko, Moralis, Solscan, Helius)
      const defaultHolderCount = heliusData?.holderCount || combinedData?.gmgn?.holders || 0;
      let holderCount = defaultHolderCount;
      try {
        const fetchedHolderCount = await this.analyticsService.getHolderCount(contractAddress, chain.toUpperCase());
        if (fetchedHolderCount !== null && fetchedHolderCount > 0) {
          holderCount = fetchedHolderCount;
        }
      } catch (error: any) {
        this.logger.debug(`Failed to fetch holder count via AnalyticsService for ${contractAddress}, using default: ${error.message}`);
      }

      // Build complete payload
      return {
        contractAddress,
        chain,
        tokenInfo: {
          name: baseToken.name || gmgnData?.name || 'Unknown',
          symbol: baseToken.symbol || gmgnData?.symbol || 'UNKNOWN',
          image: imageUrl, // Always non-null from TokenImageService
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
          count: holderCount,
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
          holderCount: holderCount,
        },
        tokenAge: Math.max(0, tokenAge),
        topTraders: (gmgnData?.topTraders || []) as any[],
      };
    } catch (error) {
      this.logger.error(`Failed to fetch all token data for ${contractAddress}:`, error);
      throw error;
    }
  }

  /**
   * Fetch data from Helius RPC API
   */
  private async fetchHeliusData(contractAddress: string) {
    try {
      const heliusApiKey = this.configService.get('HELIUS_API_KEY', '1485e891-c87d-40e1-8850-a578511c4b92');
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

      // Fetch token metadata and creation date
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

      // Calculate top holders percentages
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

      return {
        isMintable: asset?.token_info?.supply_authority !== null,
        isFreezable: asset?.token_info?.freeze_authority !== null,
        totalSupply: Number(asset?.token_info?.supply || 0),
        circulatingSupply: Number(asset?.token_info?.supply || 0), // Approximate
        holderCount: holders.length,
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
    try {
      const alchemyApiKey = this.configService.get('ALCHEMY_API_KEY', 'bSSmYhMZK2oYWgB2aMzA_');
      // Alchemy Solana API endpoint
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
    try {
      const bearTreeApiKey = this.configService.get('HELIUS_BEARTREE_API_KEY', '1485e891-c87d-40e1-8850-a578511c4b92');
      // Note: BearTree API endpoint may need to be configured
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
        creatorBalance: 0, // Would need additional API call
        creatorStatus: 'unknown',
        top10HolderRate: 0, // Would need calculation
        twitterCreateTokenCount: 0,
        lpLockPercentage: 0,
        lpLocks: [],
      };
    } catch (error: any) {
      this.logger.warn(`Helius BearTree API fetch failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Process a new token (discovery phase)
   * Fetches all data first, then sends complete payload to N8N for risk scoring
   */
  private async processNewToken(contractAddress: string, chain: string) {
    this.logger.debug(`Processing new token: ${contractAddress}`);

    // Defensive: Make sure this is a valid token for the given chain *before* doing any DB or N8N work
    if (!this.isValidAddressForChain(contractAddress, chain)) {
      this.logger.debug(`[Process Guard] Not sending to N8N. Invalid address for ${chain}: ${contractAddress}`);
      return;
    }

    try {
      // Check if listing already exists and was vetted recently (within 24 hours)
      // Only skip if it was actually vetted (has riskScore) and scanned recently
      const existingListing = await this.prisma.listing.findUnique({
        where: { contractAddress },
      });

      if (existingListing) {
        const lastScannedAt = existingListing.lastScannedAt;
        const hasRiskScore = existingListing.riskScore !== null;
        
        // Only skip if token was actually vetted (has riskScore) AND scanned recently
        if (hasRiskScore && lastScannedAt && new Date(lastScannedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
          this.logger.debug(`Token ${contractAddress} was vetted recently (riskScore: ${existingListing.riskScore}), skipping`);
          return;
        }
        
        // If token exists but wasn't vetted, log it and continue processing
        if (!hasRiskScore) {
          this.logger.debug(`Token ${contractAddress} exists but has no riskScore, will attempt vetting`);
        }
      }

      // Fetch all token data from various APIs
      this.logger.debug(`Fetching all data for ${contractAddress}...`);
      const tokenData = await this.fetchAllTokenData(contractAddress, chain);

      // ⚠️ AGE FILTER: Temporarily set to 2 days for testing (normally 14 days)
      const MIN_TOKEN_AGE_DAYS = 2;
      if (tokenData.tokenAge < MIN_TOKEN_AGE_DAYS) {
        this.logger.debug(`⏳ Skipping vetting for ${contractAddress}: Token age is ${tokenData.tokenAge} days (minimum ${MIN_TOKEN_AGE_DAYS} days required)`);
        return;
      }

      this.logger.log(`✅ Token ${contractAddress} is ${tokenData.tokenAge} days old (>= ${MIN_TOKEN_AGE_DAYS} days), proceeding with vetting`);

      const useBackendRiskScoring = this.configService.get('USE_BACKEND_RISK_SCORING', 'true') === 'true';

      if (useBackendRiskScoring) {
        // Use backend risk scoring
        this.logger.log(`⚙️ Calculating risk score in backend for ${contractAddress}`);
        
        const vettingData: TokenVettingData = {
          contractAddress: tokenData.contractAddress,
          chain: tokenData.chain,
          tokenInfo: tokenData.tokenInfo,
          security: {
            ...tokenData.security,
            totalSupply: Number(tokenData.security.totalSupply || 0),
            circulatingSupply: Number(tokenData.security.circulatingSupply || 0),
          },
          holders: tokenData.holders,
          developer: tokenData.developer,
          trading: tokenData.trading,
          tokenAge: tokenData.tokenAge,
        };

        const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(vettingData);

        await this.listingRepository.saveVettingResults({
          contractAddress,
          chain: this.mapChainToPrismaEnum(chain),
          name: vettingData.tokenInfo.name,
          symbol: vettingData.tokenInfo.symbol,
          holders: vettingData.holders.count,
          age: `${vettingData.tokenAge} days`,
          imageUrl: vettingData.tokenInfo.image,
          tokenAge: vettingData.tokenAge,
          vettingResults,
          launchAnalysis: {
            creatorAddress: vettingData.developer.creatorAddress,
            creatorBalance: vettingData.developer.creatorBalance,
            creatorStatus: vettingData.developer.creatorStatus,
            creatorTokenCount: vettingData.developer.twitterCreateTokenCount,
            top10HolderRate: vettingData.developer.top10HolderRate,
          },
          lpData: {
            lpLockPercentage: vettingData.security.lpLockPercentage,
            lpBurned: vettingData.security.lpLocks?.some((lock: any) => lock.tag === 'Burned') || false,
            lpLocked: vettingData.security.lpLockPercentage > 0,
            totalLiquidityUsd: vettingData.trading.liquidity,
            lockDetails: vettingData.security.lpLocks || [],
          },
          topHolders: vettingData.holders.topHolders,
        });

        this.logger.log(`✅ Successfully calculated and saved risk score for ${contractAddress}: ${vettingResults.overallScore} (${vettingResults.riskLevel})`);
      } else {
        // Use n8n for risk scoring
        this.logger.log(`📤 Sending complete data payload to n8n for ${contractAddress}`);
        const vettingResult = await this.n8nService.triggerInitialVetting(tokenData);

        if (vettingResult.success) {
          this.logger.log(`Successfully sent listing ${contractAddress} to N8N Automation X for vetting`);

          // Update or create listing in DB with initial vetting results
          await this.prisma.listing.upsert({
            where: { contractAddress },
            update: {
              name: vettingResult.tokenInfo?.name,
              symbol: vettingResult.tokenInfo?.symbol,
              riskScore: vettingResult.vettingResults?.overallScore,
              tier: vettingResult.vettingResults?.riskLevel,
              summary: vettingResult.vettingResults?.summary,
              lastScannedAt: new Date(),
              metadata: vettingResult.vettingResults, // Store full vetting results in metadata
            },
            create: {
              contractAddress,
              chain: this.mapChainToPrismaEnum(chain),
              name: vettingResult.tokenInfo?.name,
              symbol: vettingResult.tokenInfo?.symbol,
              riskScore: vettingResult.vettingResults?.overallScore,
              tier: vettingResult.vettingResults?.riskLevel,
              summary: vettingResult.vettingResults?.summary,
              lastScannedAt: new Date(),
              metadata: vettingResult.vettingResults, // Store full vetting results in metadata
            },
          });
        } else {
          this.logger.error(`Failed to send listing ${contractAddress} to N8N:`, vettingResult.error);
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to process new token ${contractAddress}:`, error);
    }
  }

  /**
   * Get listings that need monitoring
   */
  private async getListingsForMonitoring(batchSize: number): Promise<Listing[]> {
    try {
      // Get listings that have been vetted (Pillar 1 completed) for Pillar 2 monitoring
      // Only process tokens that have vetted = true (Pillar 1 completed)
      const listings = await this.prisma.listing.findMany({
        where: {
          vetted: true, // Only monitor tokens that have undergone Pillar 1
          riskScore: { not: null }, // Additional safety check
          OR: [
            { lastScannedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }, // Older than 30 minutes
            { lastScannedAt: null }, // Never scanned (shouldn't happen if vetted=true, but safety check)
          ],
        },
        orderBy: {
          lastScannedAt: 'asc',
        },
        take: batchSize,
      });

      return listings;
    } catch (error) {
      this.logger.error('Failed to get tokens for monitoring:', error);
      return [];
    }
  }

  /**
   * Process a batch of tokens for monitoring
   */
  private async processMonitoringBatch(listings: Listing[]) {
    this.logger.debug(`Processing monitoring batch of ${listings.length} listings`);

    const monitoringPromises = listings.map(listing => 
      this.processListingMonitoring(listing)
    );

    await Promise.allSettled(monitoringPromises);
  }

  /**
   * Process monitoring for a single listing
   * Uses Pillar2MonitoringService for continuous monitoring
   */
  private async processListingMonitoring(listing: Listing) {
    try {
      // Use Pillar2MonitoringService for direct monitoring (no N8N dependency)
      await this.pillar2MonitoringService.monitorListing(
        listing.contractAddress,
        listing.chain,
      );

      this.logger.debug(`✅ Successfully monitored listing ${listing.contractAddress}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to monitor listing ${listing.contractAddress}:`, error.message);
    }
  }

  /**
   * Validate if an address is valid for the given chain
   * Uses TokenValidatorUtil to filter out native tokens and ensure only SPL tokens are processed
   */
  private isValidAddressForChain(address: string, chain: string): boolean {
    if (!address || !chain) return false;
    
    const validation = TokenValidatorUtil.shouldProcessToken(address, chain);
    
    if (!validation.valid) {
      this.logger.debug(`[Validation] Rejected ${address} for ${chain}: ${validation.reason || 'Unknown reason'}`);
      return false;
    }
    
    return true;
  }

  /**
   * Utility method to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for token discovery (for testing)
   */
  async manualTokenDiscovery(chain: string = 'solana', limit: number = 10) {
    this.logger.log(`Manual token discovery triggered for ${chain} (limit: ${limit})`);
    
    try {
      await this.discoverTokensForChain(chain, limit);
      return { success: true, message: `Token discovery completed for ${chain}` };
    } catch (error: any) {
      this.logger.error('Manual token discovery failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Manual trigger for token monitoring (for testing)
   */
  async manualTokenMonitoring(limit: number = 10) {
    this.logger.log(`Manual token monitoring triggered (limit: ${limit})`);
    
    try {
      const listings = await this.getListingsForMonitoring(limit);
      await this.processMonitoringBatch(listings);
      return { success: true, message: `Token monitoring completed for ${listings.length} listings` };
    } catch (error: any) {
      this.logger.error('Manual token monitoring failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Recalculate risk scores for existing tokens using the new Pillar 1 algorithm
   * This ensures all tokens have consistent risk scores calculated with the same algorithm
   * 
   * @param batchSize Number of tokens to process per batch
   * @param limit Maximum number of tokens to process (0 = all)
   */
  async recalculateRiskScoresForExistingTokens(batchSize: number = 10, limit: number = 0) {
    this.logger.log(`🔄 Starting risk score recalculation for existing tokens (batch: ${batchSize}, limit: ${limit || 'all'})`);

    try {
      const useBackendRiskScoring = this.configService.get('USE_BACKEND_RISK_SCORING', 'true') === 'true';
      
      if (!useBackendRiskScoring) {
        this.logger.warn('⚠️ Backend risk scoring is disabled. Enable USE_BACKEND_RISK_SCORING=true to recalculate scores.');
        return { success: false, error: 'Backend risk scoring is disabled' };
      }

      // Fetch all listings that have been scanned (have lastScannedAt)
      // EXCLUDE pinned tokens - they are handled by RefreshWorker (Pillar 1)
      // This includes tokens with and without risk scores, so we can:
      // 1. Calculate risk scores for tokens that don't have them
      // 2. Recalculate risk scores for tokens that do have them (to use new algorithm)
      
      // Get pinned token addresses from RefreshWorker (they're defined there)
      // We'll exclude them by checking contract addresses
      const pinnedAddresses: string[] = [
        'gh8ers4yzkr3ukdvgvu8cqjfgzu4cu62mteg9bcj7ug6', // Michi
        '0x660b571d34b91bc4c2fffbf8957ad50b5fac56f4', // VINU
        '424kbbjyt6vksn7gekt9vh5yetutr1sbeyoya2nmbjpw', // SIGMA
        'hypxcaat9ybu7vya5burgprsa23hmvdqxt5udsgqwdc', // Mini
        '0x5c6919b79fac1c3555675ae59a9ac2484f3972f5', // $HOPPY
        '0xfcc89a1f250d76de198767d33e1ca9138a7fb54b', // Mochi
        '4fp4synbkisczqkwufpkcsxwfdbsvmktsnpbnlplyu9q', // snoofi
        '5ffoyq4q8qxek4v3dax64ir7yuwsxxrjy2qxduet1st', // Kieth
        '0x84196ac042ddb84137e15d1c3ff187adad61f811', // LCAT
        '2bjky9pnytdvmpdhjhv8qbweykilzebd7i2tatyjxaze', // HARAMBE
        '9uww4c36hictgrufpkwsn7ghrj9vd xktz8na8jv nzqu35pj', // BILLY
        '0x184fb097196a4e2be8dfd44b341cb7d13b41ea7e', // BOOP
        'bszedbevwrqvksaf558eppwpwcm16avepyhm2hgsq9wzyy', // SC
        '0xd6df608d847ad85375fcf1783f8ccd57be6a16d2', // LUFFY
        '0xbd85f61a1b755b6034c62f16938d6da7c85941705d9d10aa1843b809b0e35582', // FUD
        'bduggvl2ylc41bhxmzevh3zjjz69svcx6lhwfy4b71mo', // VIBE
        '35jzmqqc6ewrw6pefwdlhmtxbkvnc9mxpbes4rbws1ww', // jam
        '0x3c79593e01a7f7fed5d0735b16621e2d52a6bc58', // Bob
        '0x07f071aa224e2fc2cf03ca2e6558ec6181d66a90', // CaptainBNB
        '0x58495ea0271d957632415b5494966899a1fa0be3', // Donkey
        '0xea8b7ed6170e0ea3703dde6b496b065a8ececd7b', // Russel
        '0x40a372f9ee1989d76ceb8e50941b04468f8551d091fb8a5d7211522e42e60aaf', // Blub
        '0xb785e6eed355c1f8367c06d2b0cb9303ab167f8359a129bb003891ee54c6fce0', // hippo
      ].map(addr => addr.toLowerCase().replace(/\s/g, '')); // Normalize addresses
      
      const whereClause: any = {
        lastScannedAt: { not: null },
        contractAddress: { notIn: pinnedAddresses }, // Exclude pinned tokens
      };

      const totalCount = await (this.prisma as any).listing.count({ where: whereClause });
      const maxProcess = limit > 0 ? Math.min(limit, totalCount) : totalCount;

      this.logger.log(`📊 Found ${totalCount} tokens that have been scanned. Processing ${maxProcess} tokens...`);

      let processed = 0;
      let updated = 0;
      let failed = 0;

      // Process in batches
      for (let offset = 0; offset < maxProcess; offset += batchSize) {
        const batch = await (this.prisma as any).listing.findMany({
          where: whereClause,
          take: batchSize,
          skip: offset,
          orderBy: { updatedAt: 'desc' },
        });

        if (batch.length === 0) break;

        this.logger.log(`📦 Processing batch ${Math.floor(offset / batchSize) + 1} (${batch.length} tokens)...`);

        for (const listing of batch) {
          try {
            processed++;
            const result = await this.recalculateRiskScoreForToken(listing);
            
            if (result.success) {
              updated++;
              this.logger.debug(`✅ Recalculated risk score for ${listing.contractAddress}: ${result.newScore} (was ${listing.riskScore})`);
            } else {
              failed++;
              this.logger.warn(`⚠️ Failed to recalculate for ${listing.contractAddress}: ${result.error}`);
            }

            // Small delay to avoid rate limiting
            await this.delay(100);
          } catch (error: any) {
            failed++;
            this.logger.error(`❌ Error recalculating risk score for ${listing.contractAddress}: ${error.message}`);
          }
        }

        // Log progress
        this.logger.log(`📈 Progress: ${processed}/${maxProcess} processed, ${updated} updated, ${failed} failed`);
      }

      this.logger.log(`✅ Risk score recalculation completed: ${processed} processed, ${updated} updated, ${failed} failed`);

      return {
        success: true,
        processed,
        updated,
        failed,
        total: totalCount,
      };
    } catch (error: any) {
      this.logger.error(`❌ Risk score recalculation failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Recalculate risk score for a single token
   */
  private async recalculateRiskScoreForToken(listing: any): Promise<{ success: boolean; newScore?: number | null; error?: string }> {
    try {
      const metadata = (listing.metadata || {}) as any;
      const contractAddress = listing.contractAddress;
      const chain = listing.chain?.toLowerCase() || 'solana';

      // Extract data from metadata (if available from previous vetting)
      const existingVettingResults = metadata?.vettingResults || {};
      const launchAnalysis = metadata?.launchAnalysis || {};
      const lpData = metadata?.lpData || {};
      const topHolders = metadata?.topHolders || [];

      // Try to reconstruct TokenVettingData from metadata
      // If data is incomplete, fetch from external APIs
      let tokenVettingData: TokenVettingData;

      // Check if we have sufficient data in metadata
      const hasCompleteData = 
        existingVettingResults.componentScores &&
        launchAnalysis.creatorAddress !== undefined &&
        lpData.lpLockPercentage !== undefined &&
        topHolders.length > 0;

      if (hasCompleteData) {
        // Reconstruct from metadata
        tokenVettingData = {
          contractAddress,
          chain,
          tokenInfo: {
            name: listing.name || 'Unknown',
            symbol: listing.symbol || 'UNKNOWN',
            image: metadata?.imageUrl || '',
            decimals: 6,
          },
          security: {
            isMintable: metadata?.mintAuthDisabled === false ? false : true, // Inverted logic
            isFreezable: false, // Default assumption
            lpLockPercentage: lpData.lpLockPercentage || 0,
            totalSupply: 0,
            circulatingSupply: 0,
            lpLocks: lpData.lockDetails || [],
          },
          holders: {
            count: listing.holders || 0,
            topHolders: topHolders.map((h: any) => ({
              address: h.address || '',
              balance: h.balance || 0,
              percentage: h.percentage || 0,
            })),
          },
          developer: {
            creatorAddress: launchAnalysis.creatorAddress || null,
            creatorBalance: launchAnalysis.creatorBalance || 0,
            creatorStatus: launchAnalysis.creatorStatus || 'unknown',
            top10HolderRate: launchAnalysis.top10HolderRate || 0,
            twitterCreateTokenCount: launchAnalysis.creatorTokenCount || 0,
          },
          trading: {
            price: listing.priceUsd || 0,
            priceChange24h: listing.change24h || 0,
            volume24h: listing.volume24h || 0,
            buys24h: 0,
            sells24h: 0,
            liquidity: listing.liquidityUsd || lpData.totalLiquidityUsd || 0,
            fdv: listing.marketCap || 0,
            holderCount: listing.holders || 0,
          },
          tokenAge: metadata?.tokenAge || this.parseAgeToDays(listing.age) || 0,
        };
      } else {
        // Fetch fresh data from external APIs (same as RefreshWorker does)
        this.logger.debug(`📡 Fetching fresh data for ${contractAddress} (metadata incomplete)`);
        
        const [dexScreenerData, combinedData, imageUrl] = await Promise.all([
          this.externalApisService.fetchDexScreenerData(contractAddress, chain),
          this.externalApisService.fetchCombinedTokenData(contractAddress, chain),
          this.tokenImageService.fetchTokenImage(contractAddress, chain),
        ]);

        const heliusData = await this.fetchHeliusData(contractAddress);
        const alchemyData = await this.fetchAlchemyData(contractAddress);
        const bearTreeData = await this.fetchHeliusBearTreeData(contractAddress);

        const pair = dexScreenerData || combinedData?.dexScreener;
        const baseToken = (pair?.baseToken || {}) as { name?: string; symbol?: string; decimals?: number };
        const gmgnData = (combinedData?.gmgn as any) || {};

        // Calculate token age
        const creationTimestamp = heliusData?.creationTimestamp || pair?.pairCreatedAt || null;
        let tokenAge = 0;
        if (creationTimestamp) {
          const timestampMs = creationTimestamp > 1e12 ? creationTimestamp : creationTimestamp * 1000;
          tokenAge = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));
        } else {
          tokenAge = this.parseAgeToDays(listing.age) || 0;
        }

        // Fetch holder count using AnalyticsService (tries Birdeye, CoinGecko, Moralis, Solscan, Helius)
        const defaultHolderCount = heliusData?.holderCount || listing.holders || combinedData?.gmgn?.holders || 0;
        let holderCount = defaultHolderCount;
        try {
          const fetchedHolderCount = await this.analyticsService.getHolderCount(contractAddress, chain.toUpperCase());
          if (fetchedHolderCount !== null && fetchedHolderCount > 0) {
            holderCount = fetchedHolderCount;
          }
        } catch (error: any) {
          this.logger.debug(`Failed to fetch holder count via AnalyticsService for ${contractAddress}, using default: ${error.message}`);
        }

        tokenVettingData = {
          contractAddress,
          chain,
          tokenInfo: {
            name: baseToken.name || listing.name || 'Unknown',
            symbol: baseToken.symbol || listing.symbol || 'UNKNOWN',
            image: imageUrl,
            decimals: baseToken.decimals || 6,
          },
          security: {
            isMintable: heliusData?.isMintable ?? alchemyData?.isMintable ?? false,
            isFreezable: heliusData?.isFreezable ?? alchemyData?.isFreezable ?? false,
            lpLockPercentage: (pair?.liquidity as any)?.lockedPercentage || bearTreeData?.lpLockPercentage || lpData.lpLockPercentage || 0,
            totalSupply: Number(heliusData?.totalSupply || combinedData?.gmgn?.totalSupply || 0),
            circulatingSupply: Number(heliusData?.circulatingSupply || combinedData?.gmgn?.circulatingSupply || 0),
            lpLocks: bearTreeData?.lpLocks || lpData.lockDetails || [],
          },
          holders: {
            count: holderCount,
            topHolders: (heliusData?.topHolders || combinedData?.gmgn?.topHolders || topHolders || []).slice(0, 10).map((h: any) => ({
              address: h.address || h.id || '',
              balance: Number(h.balance || 0),
              percentage: Number(h.percentage || 0),
            })),
          },
          developer: {
            creatorAddress: bearTreeData?.creatorAddress || launchAnalysis.creatorAddress || combinedData?.gmgn?.creator?.address || null,
            creatorBalance: Number(bearTreeData?.creatorBalance || launchAnalysis.creatorBalance || combinedData?.gmgn?.creator?.balance || 0),
            creatorStatus: bearTreeData?.creatorStatus || launchAnalysis.creatorStatus || combinedData?.gmgn?.creator?.status || 'unknown',
            top10HolderRate: Number(bearTreeData?.top10HolderRate || launchAnalysis.top10HolderRate || gmgnData?.top10HolderRate || 0),
            twitterCreateTokenCount: bearTreeData?.twitterCreateTokenCount || launchAnalysis.creatorTokenCount || 0,
          },
          trading: {
            price: Number(pair?.priceUsd || listing.priceUsd || combinedData?.gmgn?.price || 0),
            priceChange24h: Number(pair?.priceChange?.h24 || listing.change24h || 0),
            volume24h: Number(pair?.volume?.h24 || listing.volume24h || combinedData?.gmgn?.volume24h || 0),
            buys24h: Number(pair?.txns?.h24?.buys || 0),
            sells24h: Number(pair?.txns?.h24?.sells || 0),
            liquidity: Number(pair?.liquidity?.usd || listing.liquidityUsd || combinedData?.gmgn?.liquidity || 0),
            fdv: Number(pair?.fdv || listing.marketCap || combinedData?.gmgn?.marketCap || 0),
            holderCount: holderCount,
          },
          tokenAge: Math.max(0, tokenAge),
        };
      }

      // Calculate new risk score
      const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(tokenVettingData);

      // Save to database
      await this.listingRepository.saveVettingResults({
        contractAddress,
        chain: chain.toUpperCase() as any,
        name: tokenVettingData.tokenInfo.name,
        symbol: tokenVettingData.tokenInfo.symbol,
        holders: tokenVettingData.holders.count,
        age: `${tokenVettingData.tokenAge} days`,
        imageUrl: tokenVettingData.tokenInfo.image,
        tokenAge: tokenVettingData.tokenAge,
        vettingResults,
        launchAnalysis: {
          creatorAddress: tokenVettingData.developer.creatorAddress,
          creatorBalance: tokenVettingData.developer.creatorBalance,
          creatorStatus: tokenVettingData.developer.creatorStatus,
          creatorTokenCount: tokenVettingData.developer.twitterCreateTokenCount,
          top10HolderRate: tokenVettingData.developer.top10HolderRate,
        },
        lpData: {
          lpLockPercentage: tokenVettingData.security.lpLockPercentage,
          lpBurned: tokenVettingData.security.lpLocks?.some((lock: any) => lock.tag === 'Burned') || false,
          lpLocked: tokenVettingData.security.lpLockPercentage > 0,
          totalLiquidityUsd: tokenVettingData.trading.liquidity,
          lockDetails: tokenVettingData.security.lpLocks || [],
        },
        topHolders: tokenVettingData.holders.topHolders,
      });

      // Log tier assignment for debugging
      this.logger.debug(`🎯 Tier assigned for ${contractAddress}: ${vettingResults.eligibleTier} (score: ${vettingResults.overallScore}, age: ${tokenVettingData.tokenAge} days, liquidity: $${tokenVettingData.trading.liquidity}, LP lock: ${tokenVettingData.security.lpLockPercentage}%)`);

      return {
        success: true,
        newScore: vettingResults.overallScore,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Parse age string (e.g., "14 days", "2d", "30 days") to number of days
   */
  private parseAgeToDays(age: string | null | undefined): number | null {
    if (!age || typeof age !== 'string') return null;
    
    const dayMatch = age.match(/(\d+)\s*d/i);
    if (dayMatch) {
      return parseInt(dayMatch[1], 10);
    }
    
    return null;
  }

}