import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalApisService } from './external-apis.service';
import { N8nService } from './n8n.service';
import { TokenImageService } from './token-image.service';
import { TokenValidatorUtil } from '../utils/token-validator.util';
import { Chain, Listing } from '@prisma/client';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private externalApisService: ExternalApisService,
    private n8nService: N8nService,
    private tokenImageService: TokenImageService,
    private httpService: HttpService,
  ) {}

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

  /**
   * Token Discovery Cron Job (Phase 1)
   * Runs every 2 minutes to discover new tokens
   */
  @Cron('0 */2 * * * *', {
    name: 'token-discovery',
    timeZone: 'UTC',
  })
  async handleTokenDiscovery() {
    const isEnabled = this.configService.get('TOKEN_DISCOVERY_ENABLED', 'true') === 'true';
    
    if (!isEnabled) {
      this.logger.debug('Token discovery cron job is disabled');
      return;
    }

    this.logger.log('Starting token discovery cron job');

    try {
      const batchSize = parseInt(this.configService.get('TOKEN_DISCOVERY_BATCH_SIZE', '50'));
      const chains = this.configService.get('TOKEN_DISCOVERY_CHAINS', 'solana').split(',');

      // Discover tokens from each chain
      for (const chain of chains) {
        await this.discoverTokensForChain(chain.trim(), batchSize);
      }

      this.logger.log('Token discovery cron job completed successfully');
    } catch (error) {
      this.logger.error('Token discovery cron job failed:', error);
    }
  }

  /**
   * Token Monitoring Cron Job (Phase 2)
   * Runs every 5 minutes to monitor existing tokens
   */
  @Cron('0 */5 * * * *', {
    name: 'token-monitoring',
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
      const tokenAge = creationTimestamp 
        ? Math.floor((Date.now() - (creationTimestamp * 1000)) / (1000 * 60 * 60 * 24))
        : 0;

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
          totalSupply: heliusData?.totalSupply || combinedData?.gmgn?.totalSupply || 0,
          circulatingSupply: heliusData?.circulatingSupply || combinedData?.gmgn?.circulatingSupply || 0,
          lpLocks: bearTreeData?.lpLocks || [],
        },
        holders: {
          count: heliusData?.holderCount || combinedData?.gmgn?.holders || 0,
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
          holderCount: heliusData?.holderCount || combinedData?.gmgn?.holders || 0,
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
      const heliusApiKey = this.configService.get('HELIUS_API_KEY', '1a00b566-9c85-4b19-b219-d3875fbcb8d3');
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
      const bearTreeApiKey = this.configService.get('HELIUS_BEARTREE_API_KEY', '99b6e8db-d86a-4d3d-a5ee-88afa8015074');
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
      // Check if listing already exists and was scanned recently (within 24 hours)
      const existingListing = await this.prisma.listing.findUnique({
        where: { contractAddress },
      });

      if (existingListing) {
        const lastScannedAt = existingListing.lastScannedAt;
        if (lastScannedAt && new Date(lastScannedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)) {
          this.logger.debug(`Token ${contractAddress} was vetted recently, skipping`);
          return;
        }
      }

      // Fetch all token data from various APIs
      this.logger.debug(`Fetching all data for ${contractAddress}...`);
      const tokenData = await this.fetchAllTokenData(contractAddress, chain);

      // ⚠️ AGE FILTER: Only vet tokens that are >= 14 days old (client requirement)
      const MIN_TOKEN_AGE_DAYS = 14;
      if (tokenData.tokenAge < MIN_TOKEN_AGE_DAYS) {
        this.logger.debug(`⏳ Skipping n8n vetting for ${contractAddress}: Token age is ${tokenData.tokenAge} days (minimum ${MIN_TOKEN_AGE_DAYS} days required)`);
        return;
      }

      this.logger.log(`✅ Token ${contractAddress} is ${tokenData.tokenAge} days old (>= ${MIN_TOKEN_AGE_DAYS} days), proceeding with n8n vetting`);

      // Send complete payload to N8N Automation X for risk scoring
      // N8N only calculates risk scores and saves to DB (no data fetching)
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
    } catch (error: any) {
      this.logger.error(`Failed to process new token ${contractAddress}:`, error);
    }
  }

  /**
   * Get listings that need monitoring
   */
  private async getListingsForMonitoring(batchSize: number): Promise<Listing[]> {
    try {
      // Get listings that have been vetted and haven't been monitored recently
      const listings = await this.prisma.listing.findMany({
        where: {
          // Assuming a listing is "approved" if it has a riskScore (i.e., has been vetted)
          riskScore: { not: null }, 
          OR: [
            { lastScannedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } }, // Older than 5 minutes
            { lastScannedAt: null }, // Never scanned
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
   * Sends listing address to N8N Automation Y for monitoring
   * N8N handles: data fetching, change detection, re-evaluation, and saving to DB
   */
  private async processListingMonitoring(listing: Listing) {
    try {
      // Send to N8N Automation Y for continuous monitoring
      // N8N will handle: data fetching, change detection, risk re-evaluation, and saving to DB
      const monitoringResult = await this.n8nService.triggerContinuousMonitoring({
        contractAddress: listing.contractAddress,
        chain: listing.chain.toLowerCase(),
      });

      if (monitoringResult.success) {
        // Update last scanned timestamp and monitoring results
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: {
            lastScannedAt: new Date(),
            // Merge new monitoring data into existing metadata
            metadata: {
              ...(listing.metadata as object || {}),
              monitoringResults: monitoringResult.monitoringResults,
            },
          },
        });

        this.logger.debug(`Successfully sent listing ${listing.contractAddress} to N8N Automation Y for monitoring`);
      } else {
        this.logger.error(`Failed to send listing ${listing.contractAddress} to N8N:`, monitoringResult.error);
      }
    } catch (error: any) {
      this.logger.error(`Failed to process monitoring for listing ${listing.contractAddress}:`, error);
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
}
