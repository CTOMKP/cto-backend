import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { SolanaApiService } from './solana-api.service';
import { validateSolanaAddress } from '../../utils/validation';
import { formatTokenAge, formatTokenAgeShort } from '../../utils/age-formatter';
import { Pillar1RiskScoringService, TokenVettingData } from '../../services/pillar1-risk-scoring.service';
import { generateAISummary } from './ai-summary.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ScanService {
  constructor(
    private readonly solanaApiService: SolanaApiService,
    private readonly prisma: PrismaService,
    private readonly pillar1RiskScoringService: Pillar1RiskScoringService,
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

      const tokenData = await this.solanaApiService.fetchTokenData(contractAddress);
      if (!tokenData) {
        throw new HttpException('Token not found or invalid contract address', HttpStatus.NOT_FOUND);
      }

      if (tokenData.project_age_days < 14) {
        const ageDisplay = formatTokenAge(tokenData.project_age_days);
        throw new HttpException(
          {
            message: `Token is too young for listing. Minimum age requirement is 14 days. This token is ${ageDisplay} old.`,
            eligible: false,
            tier: null,
            risk_score: 0,
            risk_level: 'HIGH',
            summary: 'Token too young for listing.',
            metadata: {
              token_symbol: tokenData.symbol,
              token_name: tokenData.name,
              project_age_days: tokenData.project_age_days,
              age_display: ageDisplay,
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
              lock_contract: tokenData.lock_contract,
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
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Transform SolanaApiService data to TokenVettingData format for Pillar1RiskScoringService
      const vettingData = this.transformToVettingData(contractAddress, tokenData, chain);

      // Calculate risk score using Pillar1RiskScoringService (N8N workflow formula)
      const vettingResults = this.pillar1RiskScoringService.calculateRiskScore(vettingData);

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
              lock_contract: tokenData.lock_contract,
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
      const summary = generateAISummary(tokenData, { name: vettingResults.eligibleTier }, vettingResults.overallScore);

      const result = {
        tier: vettingResults.eligibleTier === 'none' ? null : vettingResults.eligibleTier,
        risk_score: vettingResults.overallScore,
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
          lock_contract: tokenData.lock_contract,
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
          vetting_results: vettingResults,
        },
      };

      // Persist in DB if authenticated user provided
      if (userId) {
        await this.prisma.scanResult.create({
          data: {
            contractAddress,
            resultData: result as any,
            userId,
          },
        });
      }

      return result;
    } catch (error: unknown) {
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
   * Transform SolanaApiService token data to TokenVettingData format for Pillar1RiskScoringService
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
