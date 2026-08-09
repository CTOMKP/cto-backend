import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../listing/services/analytics.service';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

/**
 * Pillar 2: Continuous Monitoring Service
 * 
 * Monitors DYNAMIC metrics that change over time:
 * - Market metrics (price, volume, liquidity, market cap)
 * - Holder metrics (count, distribution, top holders)
 * - Transaction activity (buys, sells, unique wallets)
 * - LP changes (if time-locked)
 * - Wallet behavior (dev wallet, top holder movements)
 * 
 * Runs every 5 minutes to track changes and detect alerts
 */
@Injectable()
export class Pillar2MonitoringService {
  private readonly logger = new Logger(Pillar2MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Monitor a single listing and save snapshot
   */
  async monitorListing(contractAddress: string, chain: string): Promise<any> {
    this.logger.log(`🔍 Monitoring ${chain}:${contractAddress}`);

    try {
      // Get current listing data
      const listing = await this.prisma.listing.findUnique({
        where: { contractAddress },
      });

      if (!listing) {
        this.logger.warn(`Listing not found: ${contractAddress}`);
        return null;
      }

      // Get previous snapshot for comparison
      const previousSnapshot = await this.getLatestSnapshot(contractAddress);
      const comparisonSnapshot24h = await this.getSnapshotNear24HoursAgo(contractAddress);

      // Collect current monitoring data
      const monitoringData = await this.collectMonitoringData(
        contractAddress,
        chain,
        listing,
        previousSnapshot,
        comparisonSnapshot24h,
      );

      // Save snapshot to database
      const snapshot = await this.saveSnapshot(contractAddress, monitoringData);

      // Detect alerts based on changes
      await this.detectAlerts(contractAddress, monitoringData, comparisonSnapshot24h || previousSnapshot);

      // Update listing with latest monitoring timestamp
      await this.prisma.listing.update({
        where: { contractAddress },
        data: { lastScannedAt: new Date(), lastMonitoredAt: new Date() },
      });

      this.logger.log(`✅ Monitoring complete for ${contractAddress}`);
      return snapshot;
    } catch (error: any) {
      this.logger.error(`❌ Monitoring failed for ${contractAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Collect all monitoring data for a token
   */
  private async collectMonitoringData(
    contractAddress: string,
    chain: string,
    listing: any,
    previousSnapshot: any,
    comparisonSnapshot24h: any,
  ): Promise<any> {
    const now = new Date();

    // Fetch market data from DexScreener
    const marketData = await this.fetchMarketData(contractAddress, chain);
    
    // Fetch holder data
    const holderData = await this.fetchHolderData(contractAddress, chain, comparisonSnapshot24h);
    
    // Fetch transaction activity
    const activityData = this.extractActivityData(marketData);

    // Calculate trends and changes
    const trends = this.calculateTrends(marketData, holderData, activityData, previousSnapshot);

    return {
      scannedAt: now,
      currentTier: listing.tier || null,
      
      // Market metrics
      price: marketData.price ?? null,
      marketCap: marketData.marketCap ?? null,
      liquidity: marketData.liquidity ?? null,
      volume24h: marketData.volume24h ?? null,
      priceChange24h: marketData.priceChange24h ?? null,
      
      // Holder metrics
      totalHolders: holderData.totalHolders ?? null,
      holderChange24h: holderData.holderChange24h ?? null,
      topHolderPct: holderData.topHolderPct ?? null,
      top10HoldersPct: holderData.top10HoldersPct ?? null,
      
      // Activity metrics
      txns24h: activityData.txns24h || 0,
      buys24h: activityData.buys24h || 0,
      sells24h: activityData.sells24h || 0,
      uniqueWallets24h: activityData.uniqueWallets24h || 0,
      
      // Trends
      liquidityTrend: trends.liquidityTrend || 'stable',
      holderTrend: trends.holderTrend || 'stable',
      activityTrend: trends.activityTrend || 'stable',
      
      // Raw data for reference
      rawData: {
        marketData,
        holderData,
        activityData,
        comparisonSnapshotAt: comparisonSnapshot24h?.scannedAt ?? null,
      },
    };
  }

  /**
   * Fetch market data from DexScreener
   */
  private async fetchMarketData(contractAddress: string, chain: string): Promise<any> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = this.selectBestDexPair(response.data.pairs, contractAddress);
        const txns = pair.txns?.h24 || {};
        return {
          status: 'observed',
          price: parseFloat(pair.priceUsd || 0),
          marketCap: parseFloat(pair.marketCap || pair.fdv || 0),
          liquidity: parseFloat(pair.liquidity?.usd || 0),
          volume24h: parseFloat(pair.volume?.h24 || 0),
          priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
          buys24h: Number(txns.buys || 0),
          sells24h: Number(txns.sells || 0),
          pairAddress: pair.pairAddress || null,
        };
      }

      return { status: 'unknown' };
    } catch (error: any) {
      this.logger.debug(`Market data fetch failed: ${error.message}`);
      return { status: 'unknown', error: error.message };
    }
  }

  /**
   * Fetch holder data
   */
  private async fetchHolderData(
    contractAddress: string,
    chain: string,
    previousSnapshot: any,
  ): Promise<any> {
    try {
      // Get current holder count
      const totalHolders = await this.analyticsService.getHolderCount(contractAddress, chain);
      if (totalHolders === null) {
        return { status: 'unknown' };
      }

      // Calculate change from previous snapshot
      const holderChange24h = previousSnapshot
        ? totalHolders - (previousSnapshot.totalHolders || 0)
        : 0;

      // TODO: Fetch top holders distribution (requires additional API calls)
      // For now, use placeholder values
      const topHolderPct = null;
      const top10HoldersPct = null;

      return {
        status: 'observed',
        totalHolders,
        holderChange24h,
        topHolderPct,
        top10HoldersPct,
      };
    } catch (error: any) {
      this.logger.debug(`Holder data fetch failed: ${error.message}`);
      return { status: 'unknown', error: error.message };
    }
  }

  /**
   * Fetch transaction activity data
   */
  private extractActivityData(marketData: any): any {
    if (marketData?.status !== 'observed') {
      return { status: 'unknown' };
    }
    const buys24h = Number(marketData.buys24h || 0);
    const sells24h = Number(marketData.sells24h || 0);
    return {
      status: 'observed',
      txns24h: buys24h + sells24h,
      buys24h,
      sells24h,
      uniqueWallets24h: null,
    };
  }

  private selectBestDexPair(pairs: any[], contractAddress: string): any {
    const normalizedAddress = contractAddress.toLowerCase();
    return [...pairs].sort((a, b) => {
      const score = (pair: any) => {
        const liquidity = Number(pair?.liquidity?.usd || 0);
        const volume = Number(pair?.volume?.h24 || 0);
        const txns = Number(pair?.txns?.h24?.buys || 0) + Number(pair?.txns?.h24?.sells || 0);
        const base = String(pair?.baseToken?.address || '').toLowerCase();
        const quote = String(pair?.quoteToken?.address || '').toLowerCase();
        return Math.log10(liquidity + 1) * 10 + Math.log10(volume + 1) * 5 + txns +
          (base === normalizedAddress || quote === normalizedAddress ? 100 : 0);
      };
      return score(b) - score(a);
    })[0];
  }

  /**
   * Calculate trends based on current vs previous data
   */
  private calculateTrends(
    marketData: any,
    holderData: any,
    activityData: any,
    previousSnapshot: any,
  ): any {
    if (!previousSnapshot) {
      return {
        liquidityTrend: 'stable',
        holderTrend: 'stable',
        activityTrend: 'stable',
      };
    }

    // Liquidity trend
    const liquidityChange = previousSnapshot.liquidity
      ? ((marketData.liquidity - previousSnapshot.liquidity) / previousSnapshot.liquidity) * 100
      : 0;
    const liquidityTrend = liquidityChange > 5 ? 'increasing' : liquidityChange < -5 ? 'decreasing' : 'stable';

    // Holder trend
    const holderTrend = holderData.holderChange24h > 0 ? 'increasing' : holderData.holderChange24h < 0 ? 'decreasing' : 'stable';

    // Activity trend
    const activityChange = previousSnapshot.txns24h
      ? ((activityData.txns24h - previousSnapshot.txns24h) / previousSnapshot.txns24h) * 100
      : 0;
    const activityTrend = activityChange > 10 ? 'increasing' : activityChange < -10 ? 'decreasing' : 'stable';

    return {
      liquidityTrend,
      holderTrend,
      activityTrend,
    };
  }

  /**
   * Get latest snapshot for comparison
   */
  private async getLatestSnapshot(contractAddress: string): Promise<any> {
    try {
      const snapshot = await this.prisma.monitoringSnapshot.findFirst({
        where: { contractAddress },
        orderBy: { scannedAt: 'desc' },
      });

      return snapshot;
    } catch (error: any) {
      this.logger.warn(`Failed to get latest snapshot: ${error.message}`);
      return null;
    }
  }

  private async getSnapshotNear24HoursAgo(contractAddress: string): Promise<any> {
    const target = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lowerBound = new Date(target.getTime() - 3 * 60 * 60 * 1000);
    const upperBound = new Date(target.getTime() + 3 * 60 * 60 * 1000);
    try {
      return await this.prisma.monitoringSnapshot.findFirst({
        where: {
          contractAddress,
          scannedAt: { gte: lowerBound, lte: upperBound },
        },
        orderBy: { scannedAt: 'desc' },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to get 24-hour comparison snapshot: ${error.message}`);
      return null;
    }
  }

  /**
   * Save monitoring snapshot to database
   */
  private async saveSnapshot(contractAddress: string, monitoringData: any): Promise<any> {
    try {
      // Verify listing exists
      const listing = await this.prisma.listing.findUnique({
        where: { contractAddress },
        select: { id: true },
      });

      if (!listing) {
        throw new Error(`Listing not found: ${contractAddress}`);
      }

      // Create snapshot using Prisma model
      const snapshot = await this.prisma.monitoringSnapshot.create({
        data: {
          contractAddress,
          scannedAt: monitoringData.scannedAt,
          currentTier: monitoringData.currentTier || null,
          price: monitoringData.price ?? null,
          marketCap: monitoringData.marketCap ?? null,
          liquidity: monitoringData.liquidity ?? null,
          volume24h: monitoringData.volume24h ?? null,
          priceChange24h: monitoringData.priceChange24h ?? null,
          totalHolders: monitoringData.totalHolders ?? null,
          holderChange24h: monitoringData.holderChange24h ?? null,
          topHolderPct: monitoringData.topHolderPct ?? null,
          top10HoldersPct: monitoringData.top10HoldersPct ?? null,
          txns24h: monitoringData.txns24h ?? null,
          buys24h: monitoringData.buys24h ?? null,
          sells24h: monitoringData.sells24h ?? null,
          uniqueWallets24h: monitoringData.uniqueWallets24h ?? null,
          liquidityTrend: monitoringData.liquidityTrend || 'stable',
          holderTrend: monitoringData.holderTrend || 'stable',
          activityTrend: monitoringData.activityTrend || 'stable',
          rawData: monitoringData.rawData || {},
        },
      });

      return snapshot;
    } catch (error: any) {
      this.logger.error(`Failed to save snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Detect alerts based on monitoring data
   */
  private async detectAlerts(
    contractAddress: string,
    currentData: any,
    previousSnapshot: any,
  ): Promise<void> {
    if (!previousSnapshot) return; // No alerts on first snapshot

    const alerts: any[] = [];

    // Alert: Significant liquidity drop (>20% in 24h)
    if (
      previousSnapshot.liquidity !== null &&
      previousSnapshot.liquidity > 0 &&
      currentData.liquidity !== null &&
      currentData.rawData?.marketData?.status === 'observed'
    ) {
      const liquidityDrop = ((previousSnapshot.liquidity - currentData.liquidity) / previousSnapshot.liquidity) * 100;
      if (liquidityDrop > 20) {
        alerts.push({
          severity: 'high',
          triggerType: 'liquidity_drop',
          conditionDescription: `Liquidity dropped ${liquidityDrop.toFixed(2)}% in 24h`,
          message: `⚠️ Significant liquidity drop detected: ${liquidityDrop.toFixed(2)}%`,
        });
      }
    }

    // Alert: Significant holder loss (>10% in 24h)
    if (
      previousSnapshot.totalHolders !== null &&
      previousSnapshot.totalHolders > 0 &&
      currentData.totalHolders !== null &&
      currentData.rawData?.holderData?.status === 'observed'
    ) {
      const holderLoss = ((previousSnapshot.totalHolders - currentData.totalHolders) / previousSnapshot.totalHolders) * 100;
      if (holderLoss > 10) {
        alerts.push({
          severity: 'medium',
          triggerType: 'holder_loss',
          conditionDescription: `Holder count dropped ${holderLoss.toFixed(2)}% in 24h`,
          message: `⚠️ Significant holder loss detected: ${holderLoss.toFixed(2)}%`,
        });
      }
    }

    // Alert: Price crash (>30% in 24h)
    if (currentData.rawData?.marketData?.status === 'observed' && currentData.priceChange24h < -30) {
      alerts.push({
        severity: 'high',
        triggerType: 'price_crash',
        conditionDescription: `Price dropped ${Math.abs(currentData.priceChange24h).toFixed(2)}% in 24h`,
        message: `⚠️ Price crash detected: ${currentData.priceChange24h.toFixed(2)}%`,
      });
    }

    // Save alerts to database
    const alertClient = (this.prisma as any)?.alert;
    for (const alert of alerts) {
      try {
        // Verify listing exists
        const listing = await this.prisma.listing.findUnique({
          where: { contractAddress },
          select: { id: true },
        });

        if (listing) {
          const duplicate = await alertClient?.findFirst({
            where: {
              contractAddress,
              triggerType: alert.triggerType,
              resolved: false,
              createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
            },
          });
          if (duplicate) continue;
          // Create alert using Prisma model
          try {
            await alertClient?.create({
              data: {
                contractAddress,
                severity: alert.severity,
                triggerType: alert.triggerType,
                conditionDescription: alert.conditionDescription,
                actionTaken: 'monitoring_detected',
                message: alert.message,
                detected: true,
              },
            });
          } catch (error: any) {
            this.logger.warn(`Failed to save alert: ${error.message}`);
          }
        }
      } catch (error: any) {
        this.logger.debug(`Failed to save alert: ${error.message}`);
      }
    }

    if (alerts.length > 0) {
      this.logger.warn(`🚨 Detected ${alerts.length} alerts for ${contractAddress}`);
    }
  }
}







