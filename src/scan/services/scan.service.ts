import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SolanaApiService } from './solana-api.service';
import { validateSolanaAddress } from '../../utils/validation';
import { formatTokenAge, formatTokenAgeShort } from '../../utils/age-formatter';
import { Pillar1RiskScoringService, TokenVettingData } from '../../services/pillar1-risk-scoring.service';
import { ExternalApisService } from '../../services/external-apis.service';
import { TokenImageService } from '../../services/token-image.service';
import { AnalyticsService } from '../../listing/services/analytics.service';
import { generateAISummary } from './ai-summary.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly solanaApiService: SolanaApiService,
    private readonly prisma: PrismaService,
    private readonly pillar1RiskScoringService: Pillar1RiskScoringService,
    private readonly externalApisService: ExternalApisService,
    private readonly tokenImageService: TokenImageService,
    private readonly analyticsService: AnalyticsService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  // Scans a single token, optionally persists result if userId provided
  async scanToken(contractAddress: string, userId?: number, chain: 'SOLANA' | 'EVM' | 'NEAR' | 'OSMOSIS' | 'OTHER' = 'SOLANA') {
    try {
      if (!contractAddress) {
        throw new HttpException('Contract address is required', HttpStatus.BAD_REQUEST);
      }

      if (chain !== 'SOLANA') {
        return {
          tier: null,
          risk_score: null,
          risk_level: null,
          eligible: false,
          summary: `${chain} scanning not supported yet`,
          metadata: { chain, contractAddress, supported: false },
        };
      }

      if (!validateSolanaAddress(contractAddress)) {
        throw new HttpException('Invalid Solana contract address format', HttpStatus.BAD_REQUEST);
      }

      // Use the SAME comprehensive data fetching approach as RefreshWorker (Pillar 1)
      this.logger.debug(`🔍 Fetching comprehensive data for user listing scan: ${contractAddress} on ${chain}`);
      
      let dexScreenerData, combinedData, imageUrl, heliusData, alchemyData, bearTreeData;

      try {
        // Fetch data from multiple sources
        [dexScreenerData, combinedData, imageUrl] = await Promise.all([
          this.externalApisService.fetchDexScreenerData(contractAddress, chain.toLowerCase())
            .catch(e => { this.logger.warn(`DexScreener fetch failed: ${e.message}`); return null; }),
          this.externalApisService.fetchCombinedTokenData(contractAddress, chain.toLowerCase())
            .catch(e => { this.logger.warn(`Combined data fetch failed: ${e.message}`); return null; }),
          this.tokenImageService.fetchTokenImage(contractAddress, chain)
            .catch(e => { this.logger.warn(`Image fetch failed: ${e.message}`); return null; }),
        ]);

        // Fetch Helius data (token metadata, holders, creation date)
        heliusData = await this.fetchHeliusData(contractAddress);
        
        // Fetch Alchemy data (if available)
        alchemyData = await this.fetchAlchemyData(contractAddress)
          .catch(e => { this.logger.warn(`Alchemy fetch failed: ${e.message}`); return null; });
        
        // Fetch Helius BearTree data (developer info)
        bearTreeData = await this.fetchHeliusBearTreeData(contractAddress)
          .catch(e => { this.logger.warn(`BearTree fetch failed: ${e.message}`); return null; });

      } catch (error) {
        // If it's an EXTERNAL_API_BUSY or BLOCK error, stop the scan and inform the user
        if (error instanceof HttpException) {
          const status = error.getStatus();
          if (status === HttpStatus.TOO_MANY_REQUESTS || status === HttpStatus.FAILED_DEPENDENCY) {
            this.logger.error(`🛑 Scan aborted for ${contractAddress}: External providers are busy or blocking.`);
            throw new HttpException(
              'External data providers are temporarily busy or hitting rate limits. Please try again in a few minutes.',
              HttpStatus.SERVICE_UNAVAILABLE
            );
          }
        }
        throw error;
      }

      // Check if critical data was successfully fetched
      // If we don't have liquidity or holders, we CANNOT calculate a fair score.
      const hasLiquidity = !!(dexScreenerData?.liquidity?.usd || combinedData?.gmgn?.liquidity);
      const hasHolders = !!(heliusData?.holderCount || combinedData?.gmgn?.holders);

      if (!hasLiquidity || !hasHolders) {
        this.logger.error(`🛑 Critical data missing for ${contractAddress} (Liquidity: ${hasLiquidity}, Holders: ${hasHolders}). Aborting to prevent 0-score.`);
        throw new HttpException(
          'Unable to fetch critical market data (liquidity/holders) from external providers. Please try again in a moment.',
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

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

      // Calculate token age - try multiple sources (same as RefreshWorker)
      const creationTimestamp = 
        heliusData?.creationTimestamp ||           // Helius RPC (primary)
        pair?.pairCreatedAt ||                     // DexScreener pair creation
        null;

      let tokenAge = 0;

      if (creationTimestamp) {
        // Determine if timestamp is in seconds or milliseconds
        const timestampMs = creationTimestamp > 1e12 
          ? creationTimestamp  // Already in milliseconds
          : creationTimestamp * 1000; // Convert seconds to milliseconds
        
        // Calculate age from timestamp
        tokenAge = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));
        this.logger.debug(`📅 Token ${contractAddress} age calculated from timestamp: ${tokenAge} days`);
      } else {
        // Fallback: Estimate based on activity
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

      // AGE FILTER: Removed 14-day minimum (same as RefreshWorker)
      // Tokens of any age can be scanned and vetted
      // The tier calculation will handle age requirements (Seed: 14-21 days, etc.)
      this.logger.log(`✅ Processing token ${contractAddress} (age: ${tokenAge} days) with Pillar 1 risk scoring`);

      // Build COMPLETE TokenVettingData payload (same structure as RefreshWorker)
      const vettingData: TokenVettingData = {
        contractAddress,
        chain: chain.toLowerCase(),
        tokenInfo: {
          name: baseToken.name || gmgnData?.name || 'Unknown',
          symbol: baseToken.symbol || gmgnData?.symbol || 'UNKNOWN',
          image: imageUrl,
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
          // Prioritize heliusData holderCount (from AnalyticsService), then gmgn, preserve null if unavailable
          count: heliusData?.holderCount !== null && heliusData?.holderCount !== undefined 
            ? heliusData.holderCount 
            : (combinedData?.gmgn?.holders !== null && combinedData?.gmgn?.holders !== undefined
              ? combinedData.gmgn.holders
              : null),
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
          priceChange24h: Number(pair?.priceChange?.h24 || 0),
          volume24h: Number(pair?.volume?.h24 || combinedData?.gmgn?.volume24h || 0),
          buys24h: Number(pair?.txns?.h24?.buys || 0),
          sells24h: Number(pair?.txns?.h24?.sells || 0),
          liquidity: Number(pair?.liquidity?.usd || combinedData?.gmgn?.liquidity || 0),
          fdv: Number(pair?.fdv || combinedData?.gmgn?.marketCap || 0),
          holderCount: heliusData?.holderCount !== null && heliusData?.holderCount !== undefined
            ? heliusData.holderCount
            : (combinedData?.gmgn?.holders !== null && combinedData?.gmgn?.holders !== undefined
              ? combinedData.gmgn.holders
              : null),
        },
        tokenAge: Math.max(0, tokenAge),
      };

      // Log critical data fields for debugging
      this.logger.debug(`[ScanService] Token data for ${contractAddress}:`, {
        holder_count: vettingData.holders.count,
        lp_amount_usd: vettingData.trading.liquidity,
        project_age_days: vettingData.tokenAge,
        has_top_holders: !!vettingData.holders.topHolders?.length,
        top_holders_count: vettingData.holders.topHolders?.length || 0,
        creator_address: vettingData.developer.creatorAddress,
      });

      // Calculate risk score using Pillar1RiskScoringService (N8N workflow formula)
      const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(vettingData);
      
      // Log risk score calculation result
      this.logger.debug(`[ScanService] Risk score calculation result for ${contractAddress}:`, {
        overallScore: vettingResults.overallScore,
        dataSufficient: vettingResults.dataSufficient,
        missingData: vettingResults.missingData,
        riskLevel: vettingResults.riskLevel,
      });

      // Check if score meets minimum threshold (50) and data is sufficient
      if (!vettingResults.dataSufficient || !vettingResults.overallScore || vettingResults.overallScore < 50) {
        const reason = !vettingResults.dataSufficient 
          ? `Insufficient data to calculate risk score. Missing: ${vettingResults.missingData.join(', ')}`
          : `Risk score ${vettingResults.overallScore} is below minimum threshold of 50`;
        
        throw new HttpException(
          {
            message: reason,
            eligible: false,
            tier: vettingResults.eligibleTier,
            risk_score: vettingResults.overallScore || 0,
            risk_level: vettingResults.riskLevel.toUpperCase(),
            summary: reason,
            metadata: {
              token_symbol: vettingData.tokenInfo.symbol,
              token_name: vettingData.tokenInfo.name,
              project_age_days: vettingData.tokenAge,
              age_display: formatTokenAge(vettingData.tokenAge),
              age_display_short: formatTokenAgeShort(vettingData.tokenAge),
              lp_amount_usd: vettingData.trading.liquidity,
              token_price: vettingData.trading.price,
              volume_24h: vettingData.trading.volume24h,
              market_cap: vettingData.trading.fdv,
              holder_count: vettingData.holders.count,
              scan_timestamp: new Date().toISOString(),
              vetting_results: vettingResults,
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Map risk level to uppercase string for backward compatibility
      const riskLevelMap: Record<string, string> = {
        low: 'LOW',
        medium: 'MEDIUM',
        high: 'HIGH',
        insufficient_data: 'HIGH',
      };
      const riskLevel = riskLevelMap[vettingResults.riskLevel] || 'HIGH';
      
      // Build metadata for AI summary (using vettingData structure)
      // Wrap in try-catch to ensure scan result is always returned even if summary generation fails
      let summary = `Risk Level: ${vettingResults.riskLevel}. Tier: ${vettingResults.eligibleTier}`;
      try {
        const tokenMetadataForSummary = {
          symbol: vettingData.tokenInfo.symbol,
          name: vettingData.tokenInfo.name,
          project_age_days: vettingData.tokenAge,
          lp_amount_usd: vettingData.trading.liquidity,
          token_price: vettingData.trading.price,
          volume_24h: vettingData.trading.volume24h,
          market_cap: vettingData.trading.fdv,
          holder_count: vettingData.holders.count,
        };
        summary = generateAISummary(tokenMetadataForSummary, { name: vettingResults.eligibleTier }, vettingResults.overallScore);
      } catch (summaryError: any) {
        // If summary generation fails, use fallback summary - don't fail the scan
        this.logger.warn(`⚠️ Summary generation failed for ${contractAddress}: ${summaryError?.message || String(summaryError)}, using fallback summary`);
        summary = `Risk Level: ${vettingResults.riskLevel}. Tier: ${vettingResults.eligibleTier}. Risk Score: ${vettingResults.overallScore}/100`;
      }

      const result = {
        tier: vettingResults.eligibleTier === 'none' ? null : vettingResults.eligibleTier,
        risk_score: vettingResults.overallScore,
        risk_level: riskLevel,
        eligible: true,
        summary,
        metadata: {
          token_symbol: vettingData.tokenInfo.symbol,
          token_name: vettingData.tokenInfo.name,
          project_age_days: vettingData.tokenAge,
          age_display: formatTokenAge(vettingData.tokenAge),
          age_display_short: formatTokenAgeShort(vettingData.tokenAge),
          lp_amount_usd: vettingData.trading.liquidity,
          token_price: vettingData.trading.price,
          volume_24h: vettingData.trading.volume24h,
          market_cap: vettingData.trading.fdv,
          holder_count: vettingData.holders.count,
          scan_timestamp: new Date().toISOString(),
          vetting_results: vettingResults,
        },
      };

      // Persist in DB if authenticated user provided (non-blocking - don't fail the scan if DB write fails)
      if (userId) {
        try {
        await this.prisma.scanResult.create({
          data: {
            contractAddress,
            resultData: result as any,
            userId,
          },
        });
          this.logger.debug(`✅ Scan result persisted to database for ${contractAddress}`);
        } catch (dbError: any) {
          // Log DB error but don't fail the scan - the result is still valid
          this.logger.warn(`⚠️ Failed to persist scan result to database for ${contractAddress}: ${dbError?.message || String(dbError)}`);
          // Continue - the scan result is still valid even if DB write fails
        }
      }

      return result;
    } catch (error: unknown) {
      this.logger.error(`❌ Scan error for ${contractAddress}:`, error instanceof Error ? error.stack : String(error));
      const msg = error instanceof Error ? error.message : (typeof error === 'string' ? error : '');
      if (msg.includes('Token not found') || msg.includes('account not found')) {
        throw new HttpException('Token not found. Please verify the contract address is correct.', HttpStatus.NOT_FOUND);
      }
      if (msg.includes('API') || msg.includes('timeout')) {
        throw new HttpException('External API temporarily unavailable. Please try again in a moment.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (msg.includes('Invalid') || msg.includes('format')) {
        throw new HttpException('Invalid contract address format. Please check and try again.', HttpStatus.BAD_REQUEST);
      }
      if (error instanceof HttpException) throw error;
      // Log the full error for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`❌ Unexpected scan error for ${contractAddress}: ${errorMessage}`, errorStack);
      throw new HttpException('Scan failed. Please try again later.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Scans multiple tokens in batch (no persistence here to limit DB writes)
  async scanBatchTokens(contractAddresses: string[]) {
    try {
      if (!contractAddresses || !Array.isArray(contractAddresses)) {
        throw new HttpException('contractAddresses array is required', HttpStatus.BAD_REQUEST);
      }
      if (contractAddresses.length === 0) {
        throw new HttpException('At least one contract address is required', HttpStatus.BAD_REQUEST);
      }
      if (contractAddresses.length > 20) {
        throw new HttpException('Maximum 20 contract addresses allowed per batch request', HttpStatus.BAD_REQUEST);
      }

      const invalidAddresses = [] as { address: string; index: number }[];
      const validAddresses = [] as string[];
      contractAddresses.forEach((address, index) => {
        if (!validateSolanaAddress(address)) invalidAddresses.push({ address, index });
        else validAddresses.push(address);
      });
      if (invalidAddresses.length > 0) {
        throw new HttpException('Invalid contract address format(s) found', HttpStatus.BAD_REQUEST);
      }

      const scanPromises = validAddresses.map(async (contractAddress) => {
        try {
          const tokenData = await this.solanaApiService.fetchTokenData(contractAddress);
          if (!tokenData) {
            return { contractAddress, success: false, error: 'Token not found or invalid contract address', eligible: false };
          }
          if (tokenData.project_age_days < 14) {
            const ageDisplay = formatTokenAge(tokenData.project_age_days);
            return {
              contractAddress,
              success: false,
              error: `Token is too young for listing. Minimum age requirement is 14 days. This token is ${ageDisplay} old.`,
              eligible: false,
              metadata: { token_symbol: tokenData.symbol, token_name: tokenData.name, project_age_days: tokenData.project_age_days, age_display: ageDisplay, minimum_age_required: 14 },
            };
          }
          // Transform and calculate risk score using Pillar1RiskScoringService
          const vettingData = this.transformToVettingData(contractAddress, tokenData, 'SOLANA');
          const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(vettingData);
          
          if (!vettingResults.dataSufficient || !vettingResults.overallScore || vettingResults.overallScore < 50) {
            return {
              contractAddress,
              success: false,
              error: !vettingResults.dataSufficient 
                ? `Insufficient data. Missing: ${vettingResults.missingData.join(', ')}`
                : `Risk score ${vettingResults.overallScore} below minimum threshold of 50`,
              eligible: false,
              metadata: {
                token_symbol: tokenData.symbol,
                token_name: tokenData.name,
                lp_amount_usd: tokenData.lp_amount_usd,
                project_age_days: tokenData.project_age_days,
                holder_count: tokenData.holder_count,
                risk_score: vettingResults.overallScore || 0,
                tier: vettingResults.eligibleTier,
              }
            };
          }
          
          const riskScore = vettingResults.overallScore;
          const riskLevelMap: Record<string, string> = {
            low: 'LOW',
            medium: 'MEDIUM',
            high: 'HIGH',
            insufficient_data: 'HIGH',
          };
          const riskLevel = riskLevelMap[vettingResults.riskLevel] || 'HIGH';
          const summary = generateAISummary(tokenData, { name: vettingResults.eligibleTier }, riskScore);
          return {
            contractAddress,
            success: true,
            tier: vettingResults.eligibleTier === 'none' ? null : vettingResults.eligibleTier,
            risk_score: riskScore,
            risk_level: riskLevel,
            eligible: true,
            summary,
            metadata: {
              token_symbol: tokenData.symbol,
              token_name: tokenData.name,
              project_age_days: tokenData.project_age_days,
              age_display: formatTokenAge(tokenData.project_age_days),
              age_display_short: formatTokenAgeShort(tokenData.project_age_days),
              creation_date: tokenData.creation_date,
              lp_amount_usd: tokenData.lp_amount_usd,
              token_price: tokenData.token_price,
              volume_24h: tokenData.volume_24h,
              market_cap: tokenData.market_cap,
              pool_count: tokenData.pool_count,
              lp_lock_months: tokenData.lp_lock_months,
              lp_burned: tokenData.lp_burned,
              lp_locked: tokenData.lp_locked,
              lock_contract: tokenData.lock_analysis,
              lock_analysis: tokenData.lock_analysis,
              largest_lp_holder: tokenData.largest_lp_holder,
              pair_address: tokenData.pair_address,
              scan_timestamp: new Date().toISOString(),
              verified: tokenData.verified,
              holder_count: tokenData.holder_count,
              creation_transaction: tokenData.creation_transaction,
              distribution_metrics: tokenData.distribution_metrics,
              whale_analysis: tokenData.whale_analysis,
              suspicious_activity_details: tokenData.suspicious_activity,
              activity_summary: tokenData.activity_summary,
              wallet_activity_data: tokenData.wallet_activity,
              smart_contract_security: tokenData.smart_contract_risks,
            },
          };
        } catch (error: unknown) {
          let errorMessage = 'Scan failed';
          let eligible = false;
          const msg = error instanceof Error ? error.message : (typeof error === 'string' ? error : '');
          if (msg.includes('Token not found') || msg.includes('account not found')) errorMessage = 'Token not found. Please verify the contract address is correct.';
          else if (msg.includes('API') || msg.includes('timeout')) errorMessage = 'External API temporarily unavailable.';
          else if (msg.includes('Invalid') || msg.includes('format')) errorMessage = 'Invalid contract address format.';
          return { contractAddress, success: false, error: errorMessage, eligible, details: process.env.NODE_ENV === 'development' ? msg : undefined };
        }
      });

      const results = await Promise.all(scanPromises);
      const successfulScans = results.filter((r: any) => r.success);
      const failedScans = results.filter((r: any) => !r.success);
      const eligibleTokens = results.filter((r: any) => r.success && r.eligible);
      const ineligibleTokens = results.filter((r: any) => r.success && !r.eligible);

      const tokensByTier: Record<string, any[]> = {};
      eligibleTokens.forEach((token: any) => {
        const tier = token.tier;
        if (!tokensByTier[tier]) tokensByTier[tier] = [];
        tokensByTier[tier].push(token);
      });

      const tierPriority = ['Stellar', 'Bloom', 'Sprout', 'Seed'];
      const sortedTiers: Record<string, any[]> = {};
      tierPriority.forEach((tier) => {
        if (tokensByTier[tier]) sortedTiers[tier] = tokensByTier[tier].sort((a, b) => b.risk_score - a.risk_score);
      });

      return {
        batch_summary: {
          total_requested: contractAddresses.length,
          total_scanned: validAddresses.length,
          successful_scans: successfulScans.length,
          failed_scans: failedScans.length,
          eligible_tokens: eligibleTokens.length,
          ineligible_tokens: ineligibleTokens.length,
          scan_timestamp: new Date().toISOString(),
        },
        tokens_by_tier: sortedTiers,
        all_results: results,
        statistics: {
          tier_distribution: Object.keys(sortedTiers).reduce((acc: any, tier: string) => {
            acc[tier] = sortedTiers[tier].length;
            return acc;
          }, {} as Record<string, number>),
          average_risk_score: eligibleTokens.length > 0 ? Math.round(eligibleTokens.reduce((sum: number, token: any) => sum + token.risk_score, 0) / eligibleTokens.length) : 0,
          total_liquidity: eligibleTokens.reduce((sum: number, token: any) => sum + (token.metadata.lp_amount_usd || 0), 0),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('Batch scan failed. Please try again later.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Fetch data from Helius RPC API (same as RefreshWorker)
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
        holderCount: holderCount ?? null,
        topHolders,
        creationTimestamp: asset?.content?.metadata?.created_at || null,
      };
    } catch (error: any) {
      this.logger.warn(`Helius API fetch failed for ${contractAddress}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch data from Alchemy API (same as RefreshWorker)
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
   * Fetch data from Helius BearTree API (same as RefreshWorker)
   */
  private async fetchHeliusBearTreeData(contractAddress: string) {
    if (!this.httpService || !this.configService) return null;
    
    try {
      const bearTreeApiKey = this.configService.get('HELIUS_BEARTREE_API_KEY', '1485e891-c87d-40e1-8850-a578511c4b92');
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

  /**
   * DEPRECATED: Transform SolanaApiService token data to TokenVettingData format
   * This method is no longer used - we now use comprehensive data fetching (same as RefreshWorker)
   */
  private transformToVettingData(
    contractAddress: string,
    tokenData: any,
    chain: string,
  ): TokenVettingData {
    // Transform top holders: SolanaApiService uses { address, amount, share } where share is percentage
    const topHolders = (tokenData.top_holders || []).slice(0, 10).map((h: any) => ({
      address: h.address || h.owner || '',
      balance: Number(h.amount || 0),
      percentage: Number(h.share || h.percentage || 0),
    }));

    // Calculate LP lock percentage from available data
    // If LP is burned, it's 100% locked permanently
    // If LP is locked, estimate percentage based on lock duration
    // Note: SolanaApiService doesn't provide exact percentage, so we estimate conservatively
    let lpLockPercentage = 0;
    if (tokenData.lp_burned) {
      lpLockPercentage = 100; // Burned = 100% locked permanently
    } else if (tokenData.lp_locked) {
      // If locked, estimate percentage conservatively
      // Longer lock duration typically means higher percentage of LP locked
      if (tokenData.lp_lock_months >= 12) {
        lpLockPercentage = 99; // Very long lock = likely most/all LP
      } else if (tokenData.lp_lock_months >= 6) {
        lpLockPercentage = 95; // Long lock = most LP
      } else if (tokenData.lp_lock_months >= 3) {
        lpLockPercentage = 90; // Medium lock = high percentage
      } else if (tokenData.lp_lock_months > 0) {
        lpLockPercentage = 85; // Short lock = high percentage (conservative estimate)
      } else {
        // Locked but no duration info - use conservative estimate
        lpLockPercentage = 90;
      }
    }

    // Build LP locks array (for Pillar1RiskScoringService)
    const lpLocks: Array<{ tag?: string; [key: string]: any }> = [];
    if (tokenData.lp_burned) {
      lpLocks.push({ tag: 'Burned' });
    } else if (tokenData.lp_locked) {
      lpLocks.push({ tag: 'Locked', months: tokenData.lp_lock_months });
    }

    // Calculate top 10 holder rate (percentage of supply held by top 10)
    const top10HolderRate = topHolders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0) / 100;

    // Determine mint/freeze authority status
    const isMintable = !!tokenData.mint_authority;
    const isFreezable = !!tokenData.freeze_authority;

    // Create image URL (fallback to identicon if not available)
    const imageUrl = tokenData.icon || tokenData.image || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(contractAddress)}`;

    return {
      contractAddress,
      chain: chain.toLowerCase(),
      tokenInfo: {
        name: tokenData.name || 'Unknown Token',
        symbol: tokenData.symbol || 'UNKNOWN',
        image: imageUrl,
        decimals: tokenData.decimals || 6,
        description: null,
        websites: [],
        socials: [],
      },
      security: {
        isMintable,
        isFreezable,
        lpLockPercentage,
        totalSupply: Number(tokenData.total_supply || 0),
        circulatingSupply: Number(tokenData.total_supply || 0), // Assume all circulating if not provided
        lpLocks,
      },
      holders: {
        count: tokenData.holder_count || tokenData.total_holders || 0,
        topHolders,
      },
      developer: {
        // GMGN data not available from SolanaApiService, use defaults/estimates
        creatorAddress: null, // Not available without GMGN
        creatorBalance: 0, // Not available without GMGN
        creatorStatus: 'unknown', // Not available without GMGN
        top10HolderRate,
        twitterCreateTokenCount: 0, // Not available without GMGN
      },
      trading: {
        price: Number(tokenData.token_price || 0),
        priceChange24h: 0, // Not available from SolanaApiService
        volume24h: Number(tokenData.volume_24h || 0),
        buys24h: 0, // Not available from SolanaApiService
        sells24h: 0, // Not available from SolanaApiService
        liquidity: Number(tokenData.lp_amount_usd || 0),
        fdv: Number(tokenData.market_cap || 0),
        holderCount: tokenData.holder_count || tokenData.total_holders || 0,
      },
      tokenAge: Math.max(0, Math.floor(tokenData.project_age_days || 0)),
    };
  }
}
