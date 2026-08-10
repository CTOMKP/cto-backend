import { Injectable, Logger } from '@nestjs/common';

/**
 * Pillar 1 Risk Scoring Service
 * Implements the EXACT same algorithm as the n8n workflow
 * This allows us to calculate risk scores directly in the backend
 * while we work on fixing n8n connectivity issues.
 * 
 * Once n8n is working, we can switch back via feature flag.
 */

export interface TokenVettingData {
  contractAddress: string;
  chain: string;
  tokenInfo: {
    name: string;
    symbol: string;
    image: string;
    decimals: number;
    description?: string | null;
    websites?: string[];
    socials?: string[];
  };
  security: {
    isMintable: boolean | null;
    isFreezable: boolean | null;
    lpLockPercentage: number;
    totalSupply: number;
    circulatingSupply: number;
    lpLocks?: Array<{ tag?: string; [key: string]: any }>;
  };
  holders: {
    count: number | null;
    topHolders: Array<{
      address: string;
      balance: number;
      percentage: number;
    }>;
  };
  developer: {
    creatorAddress: string | null;
    creatorBalance: number | null;
    creatorStatus: string;
    top10HolderRate: number;
    twitterCreateTokenCount: number;
  };
  trading: {
    price: number | null;
    priceChange24h: number | null;
    volume24h: number | null;
    buys24h: number | null;
    sells24h: number | null;
    liquidity: number | null;
    fdv: number | null;
    holderCount: number | null;
  };
  tokenAge: number | null;
  evidence?: Partial<Record<
    'authorities' | 'holderDistribution' | 'holderCount' | 'liquidity' | 'lpLock' | 'creator' | 'tokenAge',
    'observed' | 'derived' | 'stale' | 'unknown'
  >>;
}

export interface ComponentScore {
  score: number | null;
  flags: string[];
}

export interface VettingResults {
  componentScores: {
    distribution: ComponentScore;
    liquidity: ComponentScore;
    devAbandonment: ComponentScore;
    technical: ComponentScore;
  };
  overallScore: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'insufficient_data';
  eligibleTier: 'stellar' | 'bloom' | 'sprout' | 'seed' | 'new' | 'none';
  reasonCode?: string | null;
  verificationCoverage?: number;
  riskFlags?: Array<{
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  allFlags: string[];
  dataSufficient: boolean;
  missingData: string[];
  unmetRequirements: string[];
  calculatedAt: string;
  scoringVersion: string;
  scoreDirection: 'HIGHER_IS_SAFER';
}

@Injectable()
export class Pillar1RiskScoringService {
  private readonly logger = new Logger(Pillar1RiskScoringService.name);
  static readonly SCORING_VERSION = 'pillar1-solana-v4';

  /**
   * Higher remains safer. Missing evidence is deliberately scored as zero for
   * the affected component, so provider failures can never make a token look
   * safer. The numeric result is provisional until every mandatory signal is
   * observed; provisional results cannot qualify for a listing tier.
   */
  calculateRiskScore(data: TokenVettingData): VettingResults {
    this.logger.debug(`Calculating risk score for token: ${data.contractAddress}`);

    const { holders, security, developer, trading, tokenAge } = data;
    const evidence = data.evidence || {};
    const hasAuthorityVerification =
      evidence.authorities === 'observed' &&
      typeof security?.isMintable === 'boolean' &&
      typeof security?.isFreezable === 'boolean';
    const hasReliableAge =
      evidence.tokenAge === 'observed' &&
      tokenAge !== null &&
      tokenAge !== undefined &&
      Number.isFinite(Number(tokenAge)) &&
      Number(tokenAge) >= 0;
    const hasLiquidityVerification =
      evidence.liquidity === 'observed' &&
      trading?.liquidity !== null &&
      trading?.liquidity !== undefined &&
      Number.isFinite(Number(trading.liquidity)) &&
      Number(trading.liquidity) >= 0;
    const hasLpLockVerification = evidence.lpLock === 'observed';
    const hasHolderVerification =
      evidence.holderDistribution === 'observed' &&
      evidence.holderCount === 'observed' &&
      holders?.count !== null &&
      holders?.count !== undefined &&
      Number.isFinite(Number(holders.count)) &&
      Array.isArray(holders.topHolders) &&
      holders.topHolders.length > 0;
    const hasCreatorVerification =
      evidence.creator === 'observed' &&
      !!developer?.creatorAddress &&
      developer.creatorBalance !== null &&
      developer.creatorBalance !== undefined &&
      Number.isFinite(Number(developer.creatorBalance));

    const missingData: string[] = [];
    if (!hasAuthorityVerification) missingData.push('Mint/freeze authority');
    if (!hasReliableAge) missingData.push('Token age');
    if (!hasLiquidityVerification) missingData.push('Liquidity');
    if (!hasLpLockVerification) missingData.push('LP lock verification');
    if (!hasHolderVerification) missingData.push('Holder distribution');
    if (!hasCreatorVerification) missingData.push('Creator wallet');

    const penalizedComponent = (message: string): ComponentScore => ({
      score: 0,
      flags: [`UNVERIFIED: ${message} - component scored 0/100`],
    });

    const distribution = hasHolderVerification
      ? this.calculateDistributionScore(holders, tokenAge)
      : penalizedComponent('Holder distribution');

    let liquidity = hasLiquidityVerification && hasLpLockVerification
      ? this.calculateLiquidityScore(security, trading, tokenAge)
      : penalizedComponent(
          !hasLiquidityVerification && !hasLpLockVerification
            ? 'Liquidity and LP lock evidence'
            : !hasLiquidityVerification
              ? 'Liquidity'
              : 'LP lock evidence',
        );

    // An observed 0% lock is adverse evidence, not missing evidence. The legacy
    // calculator's 35-point unknown-data deduction is increased to the defined
    // 60-point critical-risk deduction for a verified unlocked pool.
    if (
      hasLiquidityVerification &&
      hasLpLockVerification &&
      Number(security.lpLockPercentage) === 0 &&
      liquidity.score !== null
    ) {
      liquidity = {
        score: Math.max(0, liquidity.score - 25),
        flags: [
          ...liquidity.flags,
          'Verified 0% LP locked - CRITICAL RISK',
        ],
      };
    }

    const devAbandonment = hasCreatorVerification && hasReliableAge
      ? this.calculateDevAbandonmentScore(developer, tokenAge)
      : penalizedComponent(
          !hasCreatorVerification && !hasReliableAge
            ? 'Creator wallet and token age'
            : !hasCreatorVerification
              ? 'Creator wallet'
              : 'Token age',
        );
    const technical = hasAuthorityVerification
      ? this.calculateTechnicalScore(security)
      : penalizedComponent('Mint/freeze authority');

    const overallScore = Math.round(
      ((distribution.score ?? 0) * 0.25) +
      ((liquidity.score ?? 0) * 0.35) +
      ((devAbandonment.score ?? 0) * 0.20) +
      ((technical.score ?? 0) * 0.20)
    );

    const dataSufficient = missingData.length === 0;
    let riskLevel: VettingResults['riskLevel'];
    if (overallScore >= 70) riskLevel = 'low';
    else if (overallScore >= 50) riskLevel = 'medium';
    else riskLevel = 'high';

    // Incomplete verification can never be reported as low risk, even if the
    // observed components are strong.
    if (!dataSufficient && riskLevel === 'low') riskLevel = 'medium';

    const riskFlags: NonNullable<VettingResults['riskFlags']> = [];
    if (!hasLpLockVerification) {
      riskFlags.push({
        code: 'LP_LOCK_UNKNOWN',
        severity: 'high',
        message: 'LP lock duration could not be verified and received a full component penalty.',
      });
    }
    if (!hasCreatorVerification) {
      riskFlags.push({
        code: 'CREATOR_UNVERIFIED',
        severity: 'medium',
        message: 'Creator wallet could not be analyzed and received a full component penalty.',
      });
    }
    if (!hasHolderVerification) {
      riskFlags.push({
        code: 'HOLDER_DISTRIBUTION_UNVERIFIED',
        severity: 'high',
        message: 'Holder distribution could not be verified and received a full component penalty.',
      });
    }
    if (!hasReliableAge) {
      riskFlags.push({
        code: 'TOKEN_AGE_UNVERIFIED',
        severity: 'high',
        message: 'Token age could not be verified and the developer component received a full penalty.',
      });
    }
    if (!hasAuthorityVerification) {
      riskFlags.push({
        code: 'AUTHORITIES_UNVERIFIED',
        severity: 'high',
        message: 'Mint/freeze authorities could not be verified and received a full component penalty.',
      });
    }
    if (!hasLiquidityVerification) {
      riskFlags.push({
        code: 'LIQUIDITY_UNVERIFIED',
        severity: 'high',
        message: 'Liquidity could not be verified and received a full component penalty.',
      });
    }

    const verificationSignals = [
      hasAuthorityVerification,
      hasReliableAge,
      hasLiquidityVerification,
      hasLpLockVerification,
      hasHolderVerification,
      hasCreatorVerification,
    ];
    const verificationCoverage = Math.round(
      (verificationSignals.filter(Boolean).length / verificationSignals.length) * 100,
    );
    const allFlags = [
      ...distribution.flags,
      ...liquidity.flags,
      ...devAbandonment.flags,
      ...technical.flags,
    ];
    if (!dataSufficient) {
      allFlags.push(
        `PROVISIONAL SCORE: Missing ${missingData.join(', ')}; unavailable components were scored 0/100`,
      );
    }

    const lpLockMonths = this.calculateLPLockMonths(security.lpLocks || []);
    const eligibleTier = dataSufficient
      ? this.determineEligibleTier(
          overallScore,
          Number(tokenAge),
          security.lpLockPercentage || 0,
          lpLockMonths,
          trading.liquidity || 0,
        )
      : 'none';
    const unmetRequirements = dataSufficient && eligibleTier === 'none'
      ? this.getUnmetMinimumTierRequirements(
          overallScore,
          Number(tokenAge),
          lpLockMonths,
          Number(trading.liquidity),
        )
      : [];

    return {
      componentScores: { distribution, liquidity, devAbandonment, technical },
      overallScore,
      riskLevel,
      eligibleTier,
      allFlags,
      verificationCoverage,
      riskFlags,
      dataSufficient,
      missingData,
      unmetRequirements,
      calculatedAt: new Date().toISOString(),
      scoringVersion: Pillar1RiskScoringService.SCORING_VERSION,
      scoreDirection: 'HIGHER_IS_SAFER',
    };
  }

  /**
   * Calculate comprehensive risk score for a token
   * EXACT implementation of n8n workflow algorithm
   * 
   * RISK SCORE LOGIC: Higher score = Safer token (0-100 scale)
   * - 70-100: Low Risk (safe)
   * - 50-69: Medium Risk
   * - 0-49: High Risk
   */
  private calculateRiskScoreLegacy(data: TokenVettingData): VettingResults {
    this.logger.debug(`Calculating risk score for token: ${data.contractAddress}`);

    const { holders, security, developer, trading, tokenAge } = data;

    // Calculate all component scores
    const distribution = this.calculateDistributionScore(holders, tokenAge);
    const liquidity = this.calculateLiquidityScore(security, trading, tokenAge);
    const devAbandonment = this.calculateDevAbandonmentScore(developer, tokenAge);
    const technical = this.calculateTechnicalScore(security);

    // Combine all flags
    const allFlags = [
      ...distribution.flags,
      ...liquidity.flags,
      ...devAbandonment.flags,
      ...technical.flags,
    ];

    const evidence = data.evidence || {};
    const hasAuthorityVerification = evidence.authorities === 'observed' ||
      (typeof security?.isMintable === 'boolean' && typeof security?.isFreezable === 'boolean');
    const hasLiquidityVerification = evidence.liquidity === 'observed' ||
      (Number.isFinite(Number(trading?.liquidity)) && Number(trading?.liquidity) > 0);
    const hasNumericTokenAge = tokenAge !== null &&
      tokenAge !== undefined &&
      Number.isFinite(Number(tokenAge)) &&
      Number(tokenAge) >= 0;
    const hasReliableAge = evidence.tokenAge === 'observed' ||
      (evidence.tokenAge === undefined && hasNumericTokenAge);

    // These three inputs are the minimum evidence needed to publish a score.
    const missingCriticalData: string[] = [];
    if (!hasAuthorityVerification) missingCriticalData.push('Mint/freeze authority');
    if (!hasLiquidityVerification) missingCriticalData.push('Liquidity');
    if (!hasReliableAge) missingCriticalData.push('Token age');

    // CRITICAL FIX: If critical data is missing, throw error instead of defaulting to 0
    // This stops the "0/100" hallucinations caused by API rate limits
    if (distribution.score === null || liquidity.score === null) {
      this.logger.error(`❌ Critical data missing for ${data.contractAddress}. Scoring aborted to prevent 0-score hallucination.`);
      throw new Error('MISSING_CRITICAL_DATA_FOR_SCORING');
    }

    const distributionScore = distribution.score;
    const liquidityScore = liquidity.score;
    const technicalScore = technical.score ?? 0; // Technical is less critical than Distribution/Liquidity
    const devAbandonmentScore = devAbandonment.score ?? 0;

    // Distribution: 25%, Liquidity: 35%, Dev: 20%, Technical: 20%
    let overallScore = Math.round(
      (distributionScore * 0.25) +
      (liquidityScore * 0.35) +
      (devAbandonmentScore * 0.20) +
      (technicalScore * 0.20)
    );

    const hasTopHolderDistribution = evidence.holderDistribution === 'observed' ||
      !!(holders?.topHolders && holders.topHolders.length > 0);
    const hasCreatorVerification = evidence.creator === 'observed' || !!developer?.creatorAddress;
    const hasLpLockVerification = evidence.lpLock === 'observed';
    const unknownCriticalCount = [
      !hasLpLockVerification,
      !hasCreatorVerification,
      !hasTopHolderDistribution,
    ].filter(Boolean).length;

    // Prevent optimistic drift when critical verification inputs are missing.
    if (!hasLpLockVerification && overallScore > 85) {
      overallScore = 85;
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'insufficient_data' = 'insufficient_data';
    if (overallScore >= 70) {
      riskLevel = 'low';
    } else if (overallScore >= 50) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'high';
    }

    if (riskLevel === 'low' && unknownCriticalCount >= 2) {
      riskLevel = 'medium';
    }

    const riskFlags: VettingResults['riskFlags'] = [];
    if (!hasLpLockVerification) {
      riskFlags.push({
        code: 'LP_LOCK_UNKNOWN',
        severity: 'medium',
        message: 'LP lock duration could not be verified.',
      });
    }
    if (!hasCreatorVerification) {
      riskFlags.push({
        code: 'CREATOR_UNVERIFIED',
        severity: 'medium',
        message: 'Creator wallet could not be analyzed.',
      });
    }
    if (!hasTopHolderDistribution) {
      riskFlags.push({
        code: 'HOLDER_DISTRIBUTION_PARTIAL',
        severity: 'medium',
        message: 'Top holder distribution data is incomplete.',
      });
    }

    const verificationSignals = [
      hasAuthorityVerification,
      hasReliableAge,
      hasLiquidityVerification,
      hasLpLockVerification,
      hasCreatorVerification,
      hasTopHolderDistribution,
    ];
    const verificationCoverage = Math.round(
      (verificationSignals.filter(Boolean).length / verificationSignals.length) * 100
    );

    // Add warning flags for missing data
    if (missingCriticalData.length > 0) {
      allFlags.push(
        `⚠️ PARTIAL DATA: Missing ${missingCriticalData.join(', ')} data - score penalized but calculated`
      );
    }

    // Tier assignment requires independently verified LP lock evidence.
    const lpLockMonths = this.calculateLPLockMonths(security.lpLocks || []);
    const eligibleTier = missingCriticalData.length === 0 && hasLpLockVerification
      ? this.determineEligibleTier(
          overallScore,
          Number(tokenAge),
          security.lpLockPercentage || 0,
          lpLockMonths,
          trading.liquidity || 0,
        )
      : 'none';

    if (!hasLpLockVerification) missingCriticalData.push('LP lock verification');
    if (!hasTopHolderDistribution) missingCriticalData.push('Holder distribution');
    if (!hasCreatorVerification) missingCriticalData.push('Creator wallet');

    return {
      componentScores: {
        distribution,
        liquidity,
        devAbandonment,
        technical,
      },
      overallScore,
      riskLevel,
      eligibleTier,
      allFlags,
      verificationCoverage,
      riskFlags,
      dataSufficient: hasAuthorityVerification && hasLiquidityVerification && hasReliableAge,
      missingData: missingCriticalData,
      unmetRequirements: [],
      calculatedAt: new Date().toISOString(),
      scoringVersion: Pillar1RiskScoringService.SCORING_VERSION,
      scoreDirection: 'HIGHER_IS_SAFER',
    };
  }

  /**
   * 1. DISTRIBUTION SCORE (0-100)
   * Evaluates holder concentration risk
   */
  private calculateDistributionScore(
    holders: TokenVettingData['holders'],
    tokenAge: number | null
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    // If topHolders data is missing, apply penalty but still calculate based on holder count
    if (!holders || !holders.topHolders || holders.topHolders.length === 0) {
      score -= 5; // Base penalty for missing topHolders data
      flags.push('⚠️ Missing holder distribution data - penalized -5 points');
      
      // Fallback: Use holder count for basic analysis
      const holderCount = holders?.count || 0;
      if (holderCount === 0) {
        score -= 15; // Additional penalty if no holder count either
        flags.push('⚠️ No holder count data available - additional -15 penalty');
      } else if (tokenAge >= 30 && holderCount < 100) {
        score -= 20;
        flags.push(`Low holder count: ${holderCount} after ${tokenAge} days`);
      } else if (tokenAge >= 60 && holderCount < 250) {
        score -= 10;
        flags.push(`Limited growth: ${holderCount} holders after ${tokenAge} days`);
      } else if (holderCount > 1000) {
        flags.push(`Strong holder base: ${holderCount} holders (partial data)`);
      }
      
      return {
        score: Math.min(100, Math.max(0, score)),
        flags,
      };
    }

    const top1 = holders.topHolders[0]?.percentage || 0;
    const top5 = holders.topHolders.slice(0, 5).reduce((sum, h) => sum + (h.percentage || 0), 0);
    const top10 = holders.topHolders.slice(0, 10).reduce((sum, h) => sum + (h.percentage || 0), 0);

    // Top holder concentration (EXACT CTO MARKETPLACE THRESHOLDS)
    if (top1 > 20) {
      score -= 40;
      flags.push(`Top holder owns ${top1.toFixed(2)}% (>20% critical risk)`);
    } else if (top1 > 15) {
      score -= 25;
      flags.push(`Top holder owns ${top1.toFixed(2)}% (>15% high risk)`);
    } else if (top1 > 10) {
      score -= 15;
      flags.push(`Top holder owns ${top1.toFixed(2)}% (>10% concerning)`);
    } else if (top1 < 5) {
      flags.push(`Top holder owns ${top1.toFixed(2)}% (excellent distribution)`);
    }

    // Top 5 concentration
    if (top5 > 60) {
      score -= 30;
      flags.push(`Top 5 holders own ${top5.toFixed(2)}% (>60% critical centralization)`);
    } else if (top5 > 45) {
      score -= 20;
      flags.push(`Top 5 holders own ${top5.toFixed(2)}% (>45% high risk)`);
    } else if (top5 > 30) {
      score -= 10;
      flags.push(`Top 5 holders own ${top5.toFixed(2)}% (>30% concerning)`);
    }

    // Top 10 concentration
    if (top10 > 80) {
      score -= 25;
      flags.push(`Top 10 holders own ${top10.toFixed(2)}% (>80% critical centralization)`);
    } else if (top10 > 65) {
      score -= 15;
      flags.push(`Top 10 holders own ${top10.toFixed(2)}% (>65% high risk)`);
    } else if (top10 < 40) {
      flags.push(`Top 10 holders own ${top10.toFixed(2)}% (healthy distribution)`);
    }

    // Holder count analysis with age consideration
    const holderCount = holders.count || 0;
    if (tokenAge >= 30 && holderCount < 100) {
      score -= 20;
      flags.push(`Low holder count: ${holderCount} after ${tokenAge} days`);
    } else if (tokenAge >= 60 && holderCount < 250) {
      score -= 10;
      flags.push(`Limited growth: ${holderCount} holders after ${tokenAge} days`);
    } else if (holderCount > 1000) {
      flags.push(`Strong holder base: ${holderCount} holders`);
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      flags,
    };
  }

  /**
   * 2. LIQUIDITY SCORE (0-100)
   * Evaluates LP lock/burn security
   */
  private calculateLiquidityScore(
    security: TokenVettingData['security'],
    trading: TokenVettingData['trading'],
    tokenAge: number | null
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    const lpLockPercentage = Number(security?.lpLockPercentage || 0);
    const lpLocks = security.lpLocks || [];
    const burnedLP = lpLocks.find((lock: any) => lock.tag === 'Burned');

    // LP Lock percentage scoring (EXACT CTO MARKETPLACE THRESHOLDS)
    if (lpLockPercentage >= 99) {
      flags.push(`${lpLockPercentage}% LP ${burnedLP ? 'burned' : 'locked'} OK`);
    } else if (lpLockPercentage >= 90) {
      score -= 10;
      flags.push(`${lpLockPercentage}% LP locked (recommended 99%+)`);
    } else if (lpLockPercentage >= 80) {
      score -= 20;
      flags.push(`Only ${lpLockPercentage}% LP locked - MEDIUM RISK`);
    } else if (lpLockPercentage >= 50) {
      score -= 40;
      flags.push(`Only ${lpLockPercentage}% LP locked - HIGH RISK`);
    } else if (lpLockPercentage > 0) {
      score -= 60;
      flags.push(`Only ${lpLockPercentage}% LP locked - CRITICAL RISK`);
    } else {
      // Missing LP lock data - apply penalty but still calculate based on liquidity amount
      score -= 35; // Missing LP lock data is a major risk for memecoins
      flags.push('Missing LP lock data - penalized -35 points');
    }

    // Bonus for burned LP
    if (burnedLP && lpLockPercentage >= 90) {
      score += 5;
      flags.push('LP burned (stronger than lock) OK');
    }

    // Liquidity amount analysis
    const liquidityUSD = Number(trading?.liquidity || 0);
    
    // Additional penalty if liquidity data is also missing
    if (lpLockPercentage === 0 && liquidityUSD === 0) {
      score -= 10; // Additional penalty if no liquidity data either
      flags.push('⚠️ No liquidity data available - additional -10 penalty');
    } else if (liquidityUSD < 10000 && tokenAge > 14) {
      score -= 15;
      flags.push(`Low liquidity: $${liquidityUSD.toLocaleString()} (<$10k minimum)`);
    } else if (liquidityUSD >= 50000) {
      flags.push(`Strong liquidity: $${liquidityUSD.toLocaleString()}`);
    } else if (liquidityUSD >= 20000) {
      flags.push(`Adequate liquidity: $${liquidityUSD.toLocaleString()}`);
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      flags,
    };
  }

  /**
   * 3. DEV ABANDONMENT SCORE (0-100)
   * Verifies true community takeover
   */
  private calculateDevAbandonmentScore(
    developer: TokenVettingData['developer'],
    tokenAge: number | null
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    if (!developer || !developer.creatorAddress) {
      score -= 10; // Reduced penalty
      flags.push('No creator address found (data limited)');
      return { score, flags };
    }

    const creatorBalance = Number(developer.creatorBalance || 0);
    const creatorStatus = developer.creatorStatus || 'unknown';
    const top10HolderRate = developer.top10HolderRate || 0;

    // Enhanced creator status analysis with better detection
    if (creatorStatus === 'creator_sold' || creatorBalance < 1) {
      flags.push('Creator likely sold position - COMMUNITY TAKEOVER POSSIBLE');
    } else if (creatorStatus === 'creator_hold' || creatorBalance > 10) {
      score -= 30;
      flags.push(`Creator likely holds ${creatorBalance.toFixed(2)}% (>10% is concerning)`);
    } else if (creatorBalance > 5) {
      score -= 15;
      flags.push(`Creator likely holds ${creatorBalance.toFixed(2)}% (>5% is yellow flag)`);
    } else {
      flags.push(`Creator holds ${creatorBalance.toFixed(2)}% (acceptable for community token)`);
    }

    // Serial token launcher detection
    const tokenCount = developer.twitterCreateTokenCount || 0;
    if (tokenCount > 5) {
      score -= 15;
      flags.push(`Creator launched ${tokenCount} tokens (serial launcher - HIGH RISK)`);
    } else if (tokenCount > 2) {
      score -= 5;
      flags.push(`Creator launched ${tokenCount} tokens previously`);
    }

    // Top holder concentration
    if (top10HolderRate > 0.5) {
      score -= 20;
      flags.push(`Top 10 holders control ${(top10HolderRate * 100).toFixed(0)}% (>50% is risky)`);
    } else if (top10HolderRate > 0.35) {
      score -= 10;
      flags.push(`Top 10 holders control ${(top10HolderRate * 100).toFixed(0)}%`);
    }

    // Token age requirements for community tokens
    const hasReliableAge = tokenAge !== null && Number.isFinite(tokenAge);
    if (hasReliableAge && tokenAge < 14) {
      score -= 40;
      flags.push(`Token only ${tokenAge} days old (<14 days required for community tokens)`);
    } else if (hasReliableAge && tokenAge >= 30) {
      flags.push(`Token ${tokenAge} days old (good maturity) OK`);
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      flags,
    };
  }

  /**
   * 4. TECHNICAL SCORE (0-100)
   * Smart contract security checks
   */
  private calculateTechnicalScore(security: TokenVettingData['security']): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    if (!security) {
      // Missing security data - apply heavy penalty (assume worst case)
      score -= 10; // Base penalty for missing security data
      score -= 20; // Additional penalty for unknown security status (assumed risky)
      flags.push('⚠️ Missing security data - penalized -30 points (assumed risky)');
      return {
        score: Math.min(100, Math.max(0, score)),
        flags,
      };
    }

    // Check if we have at least mint/freeze authority data
    if (typeof security.isMintable !== 'boolean' || typeof security.isFreezable !== 'boolean') {
      // Missing authority data - apply penalty (assume worst case)
      score -= 10; // Base penalty for missing authority data
      score -= 20; // Additional penalty for unknown status (assumed authorities are active = risky)
      flags.push('⚠️ Missing mint/freeze authority data - penalized -30 points (assumed risky)');
      
      // Still check other security factors if available
      const totalSupply = security.totalSupply || 0;
      const circulatingSupply = security.circulatingSupply || 0;
      if (totalSupply > 0 && circulatingSupply > 0) {
        const circulatingPercentage = (circulatingSupply / totalSupply) * 100;
        if (circulatingPercentage < 80) {
          score -= 15;
          flags.push(`Only ${circulatingPercentage.toFixed(0)}% circulating (locked supply risk)`);
        } else if (circulatingPercentage >= 95) {
          flags.push(`${circulatingPercentage.toFixed(0)}% circulating (good supply distribution)`);
        }
      }
      
      return {
        score: Math.min(100, Math.max(0, score)),
        flags,
      };
    }

    const isMintable = security.isMintable;
    const isFreezable = security.isFreezable;

    // Mint authority check (EXACT CTO MARKETPLACE SCORING)
    if (isMintable === true) {
      score -= 50;
      flags.push('Mint authority NOT renounced - CRITICAL RISK');
    } else if (isMintable === false) {
      flags.push('Mint authority renounced OK');
    }

    // Freeze authority check
    if (isFreezable === true) {
      score -= 40;
      flags.push('Freeze authority active - HIGH RISK');
    } else if (isFreezable === false) {
      flags.push('Freeze authority renounced OK');
    }

    // Supply analysis
    const totalSupply = security.totalSupply || 0;
    const circulatingSupply = security.circulatingSupply || 0;

    if (totalSupply > 0 && circulatingSupply > 0) {
      const circulatingPercentage = (circulatingSupply / totalSupply) * 100;

      if (circulatingPercentage < 80) {
        score -= 15;
        flags.push(`Only ${circulatingPercentage.toFixed(0)}% circulating (locked supply risk)`);
      } else if (circulatingPercentage >= 95) {
        flags.push(`${circulatingPercentage.toFixed(0)}% circulating (good supply distribution)`);
      }
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      flags,
    };
  }

  /**
   * Calculate LP lock duration in months from lpLocks array
   */
  private calculateLPLockMonths(lpLocks: Array<{ tag?: string; [key: string]: any }>): number {
    if (!lpLocks || lpLocks.length === 0) return 0;

    const burnedLP = lpLocks.find((lock: any) =>
      String(lock?.tag || '').toLowerCase() === 'burned',
    );
    if (burnedLP) return 999;

    let maxLockMonths = 0;
    for (const lock of lpLocks) {
      const explicitMonths = Number(lock.months ?? lock.durationMonths);
      if (Number.isFinite(explicitMonths) && explicitMonths > maxLockMonths) {
        maxLockMonths = Math.floor(explicitMonths);
      }

      const durationMs = Number(lock.durationMs ?? lock.lockDurationMs);
      if (Number.isFinite(durationMs) && durationMs > 0) {
        const months = Math.floor(durationMs / (1000 * 60 * 60 * 24 * 30));
        if (months > maxLockMonths) maxLockMonths = months;
      }

      const durationSeconds = Number(lock.durationSeconds ?? lock.lockDurationSeconds);
      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        const months = Math.floor(durationSeconds / (60 * 60 * 24 * 30));
        if (months > maxLockMonths) maxLockMonths = months;
      }

      const rawUnlockTime = Number(lock.unlockTime ?? lock.unlockTimestamp);
      if (Number.isFinite(rawUnlockTime) && rawUnlockTime > 0) {
        const unlockTimeMs = rawUnlockTime < 10_000_000_000
          ? rawUnlockTime * 1000
          : rawUnlockTime;
        const months = Math.floor((unlockTimeMs - Date.now()) / (1000 * 60 * 60 * 24 * 30));
        if (months > maxLockMonths) maxLockMonths = months;
      }
    }

    return maxLockMonths;
  }

  private getUnmetMinimumTierRequirements(
    score: number,
    age: number,
    lpLockMonths: number,
    liquidityUSD: number,
  ): string[] {
    const requirements: string[] = [];
    if (!Number.isFinite(age) || age < 14) {
      requirements.push('Token age must be at least 14 days');
    }
    if (!Number.isFinite(liquidityUSD) || liquidityUSD < 10_000) {
      requirements.push('Liquidity must be at least $10,000');
    }
    if (!Number.isFinite(lpLockMonths) || lpLockMonths < 6) {
      requirements.push('LP must be locked for at least 6 months or burned');
    }
    if (!Number.isFinite(score) || score < 30) {
      requirements.push('Risk score must be at least 30/100 (higher is safer)');
    }
    if (requirements.length === 0) {
      requirements.push('Token does not satisfy a complete tier policy combination');
    }
    return requirements;
  }

  /**
   * ELIGIBLE TIER DETERMINATION (EXACT CTO MARKETPLACE TIERS - Official Documentation)
   * 
   * Official Requirements (from CTO Project Verification Process documentation):
   * - Seed: 14-21 days, $10k-$20k LP, 6-12 months lock, risk score <70 (safety score >30)
   * - Sprout: 21-30 days, $20k-$50k LP, 12-18 months lock, risk score <50 (safety score >50)
   * - Bloom: 30-60 days, $50k-$100k LP, 24-36 months lock, risk score <50 (safety score >50)
   * - Stellar: 60-90 days, $100k-$200k LP, 24-36 months lock, risk score <30 (safety score >70)
   * 
   * Note: Score logic - LOWER risk score = SAFER token, but our implementation uses HIGHER safety score = SAFER
   * So we invert: risk score <70 means safetyScore >30, risk score <50 means safetyScore >50, risk score <30 means safetyScore >70
   */
  private determineEligibleTier(
    score: number, // Safety score: higher = safer (0-100)
    age: number, // Age in days
    lpLockPercentage: number, // LP lock percentage (0-100)
    lpLockMonths: number, // LP lock duration in months
    liquidityUSD: number // Liquidity in USD
  ): 'stellar' | 'bloom' | 'sprout' | 'seed' | 'new' | 'none' {
    // Log tier evaluation for debugging
    this.logger.debug(`🔍 Tier evaluation: score=${score}, age=${age} days, liquidity=$${liquidityUSD}, LP lock=${lpLockPercentage}%, LP lock months=${lpLockMonths}`);
    
    if (!Number.isFinite(age) || age < 0) {
      this.logger.debug('Tier: none (token age unavailable)');
      return 'none';
    }

    // Lock percentage and lock duration are independent facts. Never infer duration
    // from percentage; only observed duration/burn evidence can qualify a tier.
    const effectiveLockMonths = lpLockMonths > 0 ? lpLockMonths : 0;
    const hasBurnedLP = lpLockMonths >= 999; // Burned LP = permanent lock
    
    // Check tiers from highest to lowest (Stellar -> Bloom -> Sprout -> Seed)
    // This ensures tokens get the highest tier they qualify for
    
    // Stellar Tier: Elite tier for top CTO projects
    // Age: >=60 days, LP: >=$100k (no max for established tokens), Lock: 24-36 months or burned, Score: >=70
    // Allow tokens with any liquidity above minimum (established tokens often have millions in liquidity)
    if (age >= 60 && 
        liquidityUSD >= 100000 && 
        (effectiveLockMonths >= 24 || hasBurnedLP) &&
        score >= 70) {
      this.logger.debug(`✅ Tier: stellar (age ${age} >= 60 days, liquidity $${liquidityUSD} >= $100k, LP lock ${effectiveLockMonths} months [24-36], score ${score} >= 70)`);
      return 'stellar';
    }

    // Bloom Tier: Premium tier for mature CTO projects
    // Age: >=30 days, LP: >=$50k (no max - allow high liquidity tokens), Lock: 24-36 months, Score: >=50
    // Allow tokens with liquidity >= $50k (no upper limit - high liquidity tokens can still be Bloom if they don't meet Stellar)
    if (age >= 30 && 
        liquidityUSD >= 50000 && 
        effectiveLockMonths >= 24 &&
        score >= 50) {
      this.logger.debug(`✅ Tier: bloom (age ${age} >= 30 days, liquidity $${liquidityUSD} >= $50k, LP lock ${effectiveLockMonths} months [24-36], score ${score} >= 50)`);
      return 'bloom';
    }

    // Sprout Tier: Mid-level tier for growing CTO projects
    // Age: >=21 days, LP: >=$20k (no max), Lock: 12-18 months, Score: >=50
    // Allow tokens with liquidity >= $20k (no upper limit - high liquidity tokens can still be Sprout if they don't meet Bloom/Stellar)
    if (age >= 21 && 
        liquidityUSD >= 20000 && 
        effectiveLockMonths >= 12 &&
        score >= 50) {
      this.logger.debug(`✅ Tier: sprout (age ${age} >= 21 days, liquidity $${liquidityUSD} >= $20k, LP lock ${effectiveLockMonths} months [12-18], score ${score} >= 50)`);
      return 'sprout';
    }

    // Seed Tier: Entry-level tier for new CTO projects
    // Age: >=14 days, LP: >=$10k (no max), Lock: 6-12 months, Score: >=30
    // Allow tokens with liquidity >= $10k (no upper limit - high liquidity tokens can still be Seed if they don't meet higher tiers)
    if (age >= 14 && 
        liquidityUSD >= 10000 && 
        effectiveLockMonths >= 6 &&
        score >= 30) {
      this.logger.debug(`✅ Tier: seed (age ${age} >= 14 days, liquidity $${liquidityUSD} >= $10k, LP lock ${effectiveLockMonths} months [6-12], score ${score} >= 30)`);
      return 'seed';
    }

    // Log why tier wasn't assigned (check what's missing for Seed tier as minimum)
    const missingReqs: string[] = [];
    if (age < 14) missingReqs.push(`age ${age} < 14 days (minimum for Seed)`);
    if (age > 21 && age < 30) missingReqs.push(`age ${age} days (outside Seed range 14-21, but below Sprout minimum 21)`);
    if (liquidityUSD < 10000) missingReqs.push(`liquidity $${liquidityUSD} < $10k (minimum for Seed)`);
    if (liquidityUSD > 20000 && liquidityUSD < 50000) missingReqs.push(`liquidity $${liquidityUSD} (outside Seed range $10k-$20k, but below Sprout minimum $20k)`);
    // LP lock requirement is mandatory for tier assignment
    if (effectiveLockMonths < 6) missingReqs.push(`LP lock ${effectiveLockMonths} months < 6 months`);
    if (score < 30) missingReqs.push(`score ${score} < 30 (minimum for Seed tier, risk score <70)`);
    
    this.logger.debug(`❌ Tier: none (missing requirements: ${missingReqs.join(', ')})`);
    return 'none';
  }
}


