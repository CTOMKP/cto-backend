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
    isMintable: boolean;
    isFreezable: boolean;
    lpLockPercentage: number;
    totalSupply: number;
    circulatingSupply: number;
    lpLocks?: Array<{ tag?: string; [key: string]: any }>;
  };
  holders: {
    count: number;
    topHolders: Array<{
      address: string;
      balance: number;
      percentage: number;
    }>;
  };
  developer: {
    creatorAddress: string | null;
    creatorBalance: number;
    creatorStatus: string;
    top10HolderRate: number;
    twitterCreateTokenCount: number;
  };
  trading: {
    price: number;
    priceChange24h: number;
    volume24h: number;
    buys24h: number;
    sells24h: number;
    liquidity: number;
    fdv: number;
    holderCount: number;
  };
  tokenAge: number;
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
  eligibleTier: 'stellar' | 'bloom' | 'sprout' | 'seed' | 'none';
  allFlags: string[];
  dataSufficient: boolean;
  missingData: string[];
  calculatedAt: string;
}

@Injectable()
export class Pillar1RiskScoringService {
  private readonly logger = new Logger(Pillar1RiskScoringService.name);

  /**
   * Calculate comprehensive risk score for a token
   * EXACT implementation of n8n workflow algorithm
   */
  calculateRiskScore(data: TokenVettingData): VettingResults {
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

    // Check data sufficiency
    const missingCriticalData: string[] = [];
    if (distribution.score === null) missingCriticalData.push('Distribution');
    if (liquidity.score === null) missingCriticalData.push('Liquidity');
    if (technical.score === null) missingCriticalData.push('Technical');

    const dataSufficient = missingCriticalData.length === 0;

    // Calculate weighted overall score (only if sufficient data)
    let overallScore: number | null = null;
    let riskLevel: 'low' | 'medium' | 'high' | 'insufficient_data' = 'insufficient_data';

    if (dataSufficient) {
      // Distribution: 25%, Liquidity: 35%, Dev: 20%, Technical: 20%
      overallScore = Math.round(
        (distribution.score * 0.25) +
        (liquidity.score * 0.35) +
        (devAbandonment.score * 0.20) +
        (technical.score * 0.20)
      );

      // Determine risk level
      if (overallScore >= 70) {
        riskLevel = 'low';
      } else if (overallScore >= 50) {
        riskLevel = 'medium';
      } else {
        riskLevel = 'high';
      }
    } else {
      allFlags.push(
        `🚫 CANNOT CALCULATE: Missing critical data (${missingCriticalData.join(', ')}) - Risk score cannot be determined`
      );
    }

    // Determine eligible tier
    const eligibleTier = overallScore !== null
      ? this.determineEligibleTier(
          overallScore,
          tokenAge,
          security.lpLockPercentage || 0,
          trading.liquidity || 0
        )
      : 'none';

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
      dataSufficient,
      missingData: missingCriticalData,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * 1. DISTRIBUTION SCORE (0-100)
   * Evaluates holder concentration risk
   */
  private calculateDistributionScore(
    holders: TokenVettingData['holders'],
    tokenAge: number
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    if (!holders || !holders.topHolders || holders.topHolders.length === 0) {
      return {
        score: null,
        flags: ['⚠️ INSUFFICIENT DATA: Holder distribution data not available - cannot calculate distribution score'],
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
    tokenAge: number
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    const lpLockPercentage = security.lpLockPercentage || 0;
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
      return {
        score: null,
        flags: ['⚠️ INSUFFICIENT DATA: LP lock data not available - cannot calculate liquidity score'],
      };
    }

    // Bonus for burned LP
    if (burnedLP && lpLockPercentage >= 90) {
      score += 5;
      flags.push('LP burned (stronger than lock) OK');
    }

    // Liquidity amount analysis
    const liquidityUSD = trading?.liquidity || 0;

    if (liquidityUSD < 10000 && tokenAge > 14) {
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
    tokenAge: number
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    if (!developer || !developer.creatorAddress) {
      score -= 10; // Reduced penalty
      flags.push('No creator address found (data limited)');
      return { score, flags };
    }

    const creatorBalance = developer.creatorBalance || 0;
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
    if (tokenAge < 14) {
      score -= 40;
      flags.push(`Token only ${tokenAge} days old (<14 days required for community tokens)`);
    } else if (tokenAge >= 30) {
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
      return {
        score: null,
        flags: ['⚠️ INSUFFICIENT DATA: Security data not available - cannot calculate technical score'],
      };
    }

    // Check if we have at least mint/freeze authority data
    if (security.isMintable === undefined && security.isFreezable === undefined) {
      return {
        score: null,
        flags: ['⚠️ INSUFFICIENT DATA: Mint/Freeze authority data not available - cannot calculate technical score'],
      };
    }

    const isMintable = security.isMintable || false;
    const isFreezable = security.isFreezable || false;

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
   * ELIGIBLE TIER DETERMINATION (EXACT CTO MARKETPLACE TIERS)
   */
  private determineEligibleTier(
    score: number,
    age: number,
    lpLockPercentage: number,
    liquidityUSD: number
  ): 'stellar' | 'bloom' | 'sprout' | 'seed' | 'none' {
    if (score < 50) return 'none';

    // Stellar: Highest tier - established community tokens
    if (age >= 60 && liquidityUSD >= 100000 && lpLockPercentage >= 99 && score >= 70) {
      return 'stellar';
    }

    // Bloom: Strong performing tokens
    if (age >= 30 && liquidityUSD >= 50000 && lpLockPercentage >= 90 && score >= 65) {
      return 'bloom';
    }

    // Sprout: Growing community tokens
    if (age >= 21 && liquidityUSD >= 20000 && lpLockPercentage >= 90 && score >= 60) {
      return 'sprout';
    }

    // Seed: Basic eligibility
    if (age >= 14 && liquidityUSD >= 10000 && lpLockPercentage >= 80 && score >= 50) {
      return 'seed';
    }

    return 'none';
  }
}

