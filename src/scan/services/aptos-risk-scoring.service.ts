import { Injectable, Logger } from '@nestjs/common';
import { TokenVettingData, VettingResults, ComponentScore } from '../../services/pillar1-risk-scoring.service';

@Injectable()
export class AptosRiskScoringService {
  private readonly logger = new Logger(AptosRiskScoringService.name);

  calculateRiskScore(
    data: TokenVettingData,
    context?: { panoraTags?: string[]; verified?: boolean | null; hasReliableAge?: boolean },
  ): VettingResults {
    this.logger.debug(`Calculating Aptos risk score for token: ${data.contractAddress}`);

    const distribution = this.calculateDistributionScore(data.holders, data.tokenAge);
    const liquidity = this.calculateLiquidityScore(data.trading, data.tokenAge, context?.panoraTags || []);
    const devAbandonment = this.calculateDevScore(data.developer, data.tokenAge);
    const technical = this.calculateTechnicalScore(data, context);

    let overallScore = Math.round(
      distribution.score * 0.3 +
      liquidity.score * 0.35 +
      devAbandonment.score * 0.15 +
      technical.score * 0.2,
    );

    const missingCriticalData: string[] = [];
    if (!data.holders?.count && (!data.holders?.topHolders || data.holders.topHolders.length === 0)) {
      missingCriticalData.push('Holders');
    }
    if (!data.trading?.liquidity || data.trading.liquidity <= 0) {
      missingCriticalData.push('Liquidity');
    }
    if (!data.trading?.volume24h || data.trading.volume24h <= 0) {
      missingCriticalData.push('24h Volume');
    }
    if (context?.hasReliableAge === false) {
      missingCriticalData.push('Token Age');
    }

    if (missingCriticalData.length > 0) {
      // Keep scoring available, but never allow high-confidence pass when core data is absent.
      overallScore = Math.min(overallScore, 49);
      this.logger.debug(
        `Aptos confidence gate applied for ${data.contractAddress}. Missing: ${missingCriticalData.join(', ')}`,
      );
    }

    let riskLevel: VettingResults['riskLevel'] = 'high';
    if (overallScore >= 70) riskLevel = 'low';
    else if (overallScore >= 50) riskLevel = 'medium';
    if (missingCriticalData.length > 0) {
      riskLevel = 'insufficient_data';
    }

    const eligibleTier = this.determineEligibleTier(
      overallScore,
      data.tokenAge,
      data.trading.liquidity,
      data.trading.volume24h,
      context?.panoraTags || [],
      missingCriticalData.length > 0,
    );

    const allFlags = [
      ...distribution.flags,
      ...liquidity.flags,
      ...devAbandonment.flags,
      ...technical.flags,
    ];
    if (missingCriticalData.length > 0) {
      allFlags.push(`Insufficient critical data: ${missingCriticalData.join(', ')}.`);
    }

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
      dataSufficient: missingCriticalData.length === 0,
      missingData: missingCriticalData,
      calculatedAt: new Date().toISOString(),
    };
  }

  private calculateDistributionScore(holders: TokenVettingData['holders'], tokenAge: number): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    const holderCount = holders.count || 0;
    const topHolders = holders.topHolders || [];

    if (topHolders.length > 0) {
      const top1 = topHolders[0]?.percentage || 0;
      const top5 = topHolders.slice(0, 5).reduce((sum, h) => sum + (h.percentage || 0), 0);
      const top10 = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.percentage || 0), 0);

      if (top1 > 20) {
        score -= 35;
        flags.push(`Top holder owns ${top1.toFixed(2)}% (>20% critical concentration)`);
      } else if (top1 > 10) {
        score -= 15;
        flags.push(`Top holder owns ${top1.toFixed(2)}% (>10% concerning)`);
      }

      if (top5 > 60) {
        score -= 25;
        flags.push(`Top 5 holders own ${top5.toFixed(2)}% (>60% critical centralization)`);
      } else if (top5 > 40) {
        score -= 12;
        flags.push(`Top 5 holders own ${top5.toFixed(2)}% (>40% concentrated)`);
      }

      if (top10 > 80) {
        score -= 20;
        flags.push(`Top 10 holders own ${top10.toFixed(2)}% (>80% critical centralization)`);
      } else if (top10 < 35 && holderCount > 100) {
        flags.push(`Top 10 holders own ${top10.toFixed(2)}% (healthy distribution)`);
      }
    } else {
      score -= 8;
      flags.push('Limited holder distribution data available');
    }

    if (tokenAge >= 30 && holderCount < 100) {
      score -= 15;
      flags.push(`Low holder count: ${holderCount} after ${tokenAge} days`);
    } else if (tokenAge >= 60 && holderCount < 250) {
      score -= 10;
      flags.push(`Limited holder growth: ${holderCount} after ${tokenAge} days`);
    } else if (holderCount > 1000) {
      flags.push(`Strong holder base: ${holderCount} holders`);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
    };
  }

  private calculateLiquidityScore(
    trading: TokenVettingData['trading'],
    tokenAge: number,
    panoraTags: string[],
  ): ComponentScore {
    let score = 100;
    const flags: string[] = [];
    const liquidity = Number(trading.liquidity || 0);
    const volume24h = Number(trading.volume24h || 0);
    const tags = new Set(panoraTags.map((tag) => tag.toLowerCase()));

    if (liquidity <= 0) {
      score -= 35;
      flags.push('No verified liquidity data available');
    } else if (liquidity < 5000) {
      score -= 25;
      flags.push(`Low liquidity: $${liquidity.toLocaleString()} (<$5k)`);
    } else if (liquidity < 10000) {
      score -= 15;
      flags.push(`Liquidity is below preferred baseline: $${liquidity.toLocaleString()}`);
    } else if (liquidity >= 50000) {
      flags.push(`Strong liquidity: $${liquidity.toLocaleString()}`);
    }

    if (volume24h <= 0 && tokenAge > 14) {
      score -= 15;
      flags.push('No recent trading volume detected');
    } else if (volume24h > 0 && liquidity > 0) {
      const turnover = volume24h / liquidity;
      if (turnover > 0.5) {
        flags.push(`Healthy turnover: ${(turnover * 100).toFixed(0)}% of liquidity traded in 24h`);
      } else if (turnover < 0.02 && tokenAge > 30) {
        score -= 8;
        flags.push('Very low turnover relative to liquidity');
      }
    }

    if (tags.has('banned')) {
      score = 0;
      flags.push('Panora marks this token as banned');
    } else {
      if (tags.has('recognized')) {
        score += 5;
        flags.push('Panora marks this token as recognized');
      }
      if (tags.has('emojicoin')) {
        flags.push('Panora classifies this token as an emojicoin');
      }
      if (tags.has('meme')) {
        flags.push('Panora classifies this token as a meme token');
      }
      if (tags.has('unverified')) {
        score -= 10;
        flags.push('Panora marks this token as unverified');
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
    };
  }

  private calculateDevScore(developer: TokenVettingData['developer'], tokenAge: number): ComponentScore {
    let score = 100;
    const flags: string[] = [];

    if (!developer.creatorAddress) {
      score -= 10;
      flags.push('Creator address could not be determined');
    } else if (developer.creatorBalance > 20) {
      score -= 25;
      flags.push(`Creator holds ${developer.creatorBalance.toFixed(2)}% (>20% critical)`);
    } else if (developer.creatorBalance > 10) {
      score -= 15;
      flags.push(`Creator holds ${developer.creatorBalance.toFixed(2)}% (>10% concerning)`);
    } else {
      flags.push(`Creator holds ${developer.creatorBalance.toFixed(2)}% (acceptable)`);
    }

    if (tokenAge < 14) {
      score -= 30;
      flags.push(`Token only ${tokenAge} days old (<14 day baseline)`);
    } else if (tokenAge >= 30) {
      flags.push(`Token ${tokenAge} days old (good maturity)`);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
    };
  }

  private calculateTechnicalScore(
    data: TokenVettingData,
    context?: { panoraTags?: string[]; verified?: boolean | null },
  ): ComponentScore {
    let score = 85;
    const flags: string[] = [];
    const tags = new Set((context?.panoraTags || []).map((tag) => tag.toLowerCase()));

    if (!data.tokenInfo.name || !data.tokenInfo.symbol) {
      score -= 20;
      flags.push('Missing token metadata');
    }

    if (!data.tokenInfo.image) {
      score -= 5;
      flags.push('Missing token image metadata');
    }

    if (context?.verified === true || tags.has('recognized')) {
      score += 10;
      flags.push('Verified metadata source');
    }

    if (tags.has('banned')) {
      score = 0;
      flags.push('Banned token status');
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
    };
  }

  private determineEligibleTier(
    score: number,
    ageDays: number,
    liquidityUsd: number,
    volume24h: number,
    panoraTags: string[],
    hasCriticalDataGap: boolean,
  ): VettingResults['eligibleTier'] {
    const tags = new Set(panoraTags.map((tag) => tag.toLowerCase()));
    if (tags.has('banned')) return 'none';
    if (hasCriticalDataGap) return 'none';
    if (score < 50) return 'none';

    if (ageDays >= 60 && liquidityUsd >= 100000 && volume24h >= 10000 && score >= 75) return 'stellar';
    if (ageDays >= 30 && liquidityUsd >= 50000 && volume24h >= 5000 && score >= 65) return 'bloom';
    if (ageDays >= 21 && liquidityUsd >= 20000 && volume24h >= 1500 && score >= 58) return 'sprout';
    if (ageDays >= 14 && liquidityUsd >= 10000 && score >= 50) return 'seed';
    if (ageDays < 14 && liquidityUsd >= 5000 && score >= 60) return 'new';
    return 'none';
  }
}
