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

      // Collect current monitoring data
      const monitoringData = await this.collectMonitoringData(
        contractAddress,
        chain,
        listing,
        previousSnapshot,
      );

      // Save snapshot to database
      const snapshot = await this.saveSnapshot(contractAddress, monitoringData);

      // Detect alerts based on changes
      await this.detectAlerts(contractAddress, monitoringData, previousSnapshot);

      // Update listing with latest monitoring timestamp
      await this.prisma.listing.update({
        where: { contractAddress },
        data: { lastScannedAt: new Date() },
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
  ): Promise<any> {
    const now = new Date();

    // Fetch market data from DexScreener
    const marketData = await this.fetchMarketData(contractAddress, chain);
    
    // Fetch holder data
    const holderData = await this.fetchHolderData(contractAddress, chain, previousSnapshot);
    
    // Fetch transaction activity
    const activityData = await this.fetchActivityData(contractAddress, chain);

    // Calculate trends and changes
    const trends = this.calculateTrends(marketData, holderData, activityData, previousSnapshot);

    return {
      scannedAt: now,
      currentTier: listing.tier || null,
      
      // Market metrics
      price: marketData.price || 0,
      marketCap: marketData.marketCap || 0,
      liquidity: marketData.liquidity || 0,
      volume24h: marketData.volume24h || 0,
      priceChange24h: marketData.priceChange24h || 0,
      
      // Holder metrics
      totalHolders: holderData.totalHolders || 0,
      holderChange24h: holderData.holderChange24h || 0,
      topHolderPct: holderData.topHolderPct || 0,
      top10HoldersPct: holderData.top10HoldersPct || 0,
      
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
        const pair = response.data.pairs[0];
        return {
          price: parseFloat(pair.priceUsd || 0),
          marketCap: parseFloat(pair.marketCap || pair.fdv || 0),
          liquidity: parseFloat(pair.liquidity?.usd || 0),
          volume24h: parseFloat(pair.volume?.h24 || 0),
          priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
        };
      }

      return {};
    } catch (error: any) {
      this.logger.debug(`Market data fetch failed: ${error.message}`);
      return {};
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
      const totalHolders = await this.analyticsService.getHolderCount(contractAddress, chain) || 0;

      // Calculate change from previous snapshot
      const holderChange24h = previousSnapshot
        ? totalHolders - (previousSnapshot.totalHolders || 0)
        : 0;

      // TODO: Fetch top holders distribution (requires additional API calls)
      // For now, use placeholder values
      const topHolderPct = 0; // Will be populated when we have top holders API
      const top10HoldersPct = 0;

      return {
        totalHolders,
        holderChange24h,
        topHolderPct,
        top10HoldersPct,
      };
    } catch (error: any) {
      this.logger.debug(`Holder data fetch failed: ${error.message}`);
      return {};
    }
  }

  /**
   * Fetch transaction activity data
   */
  private async fetchActivityData(contractAddress: string, chain: string): Promise<any> {
    try {
      // DexScreener provides transaction counts
      const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const txns = pair.txns || {};
        
        return {
          txns24h: (txns.h24?.buys || 0) + (txns.h24?.sells || 0),
          buys24h: txns.h24?.buys || 0,
          sells24h: txns.h24?.sells || 0,
          uniqueWallets24h: 0, // Not available from DexScreener
        };
      }

      return {};
    } catch (error: any) {
      this.logger.debug(`Activity data fetch failed: ${error.message}`);
      return {};
    }
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
      // Get latest snapshot using contract_address (since monitoring_snapshots references Listing by contractAddress)
      const result = await this.prisma.$queryRaw`
        SELECT * FROM monitoring_snapshots
        WHERE contract_address = ${contractAddress}
        ORDER BY scanned_at DESC
        LIMIT 1
      ` as any[];

      return result[0] || null;
    } catch (error: any) {
      this.logger.debug(`Failed to get latest snapshot: ${error.message}`);
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

      // Insert snapshot using raw query (monitoring_snapshots table)
      // Use contract_address directly (no foreign key to Listing.id since it's String/cuid, not UUID)
      const snapshot = await this.prisma.$queryRaw`
        INSERT INTO monitoring_snapshots (
          contract_address,
          scanned_at,
          current_tier,
          price,
          market_cap,
          liquidity,
          volume_24h,
          price_change_24h,
          total_holders,
          holder_change_24h,
          top_holder_pct,
          top_10_holders_pct,
          txns_24h,
          buys_24h,
          sells_24h,
          unique_wallets_24h,
          liquidity_trend,
          holder_trend,
          activity_trend,
          raw_data
        ) VALUES (
          ${contractAddress}::varchar,
          ${monitoringData.scannedAt}::timestamp,
          ${monitoringData.currentTier || null}::varchar,
          ${monitoringData.price || 0}::decimal,
          ${monitoringData.marketCap || 0}::decimal,
          ${monitoringData.liquidity || 0}::decimal,
          ${monitoringData.volume24h || 0}::decimal,
          ${monitoringData.priceChange24h || 0}::decimal,
          ${monitoringData.totalHolders || 0}::integer,
          ${monitoringData.holderChange24h || 0}::integer,
          ${monitoringData.topHolderPct || 0}::decimal,
          ${monitoringData.top10HoldersPct || 0}::decimal,
          ${monitoringData.txns24h || 0}::integer,
          ${monitoringData.buys24h || 0}::integer,
          ${monitoringData.sells24h || 0}::integer,
          ${monitoringData.uniqueWallets24h || 0}::integer,
          ${monitoringData.liquidityTrend || 'stable'}::varchar,
          ${monitoringData.holderTrend || 'stable'}::varchar,
          ${monitoringData.activityTrend || 'stable'}::varchar,
          ${JSON.stringify(monitoringData.rawData || {})}::jsonb
        )
        RETURNING *
      `;

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
    if (previousSnapshot.liquidity && currentData.liquidity) {
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
    if (previousSnapshot.totalHolders && currentData.totalHolders) {
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
    if (currentData.priceChange24h < -30) {
      alerts.push({
        severity: 'high',
        triggerType: 'price_crash',
        conditionDescription: `Price dropped ${Math.abs(currentData.priceChange24h).toFixed(2)}% in 24h`,
        message: `⚠️ Price crash detected: ${currentData.priceChange24h.toFixed(2)}%`,
      });
    }

    // Save alerts to database
    for (const alert of alerts) {
      try {
        // Verify listing exists
        const listing = await this.prisma.listing.findUnique({
          where: { contractAddress },
          select: { id: true },
        });

        if (listing) {
          // Use contract_address directly (no foreign key to Listing.id)
          await this.prisma.$executeRaw`
            INSERT INTO alerts (
              contract_address,
              severity,
              trigger_type,
              condition_description,
              action_taken,
              message,
              detected
            ) VALUES (
              ${contractAddress}::varchar,
              ${alert.severity}::varchar,
              ${alert.triggerType}::varchar,
              ${alert.conditionDescription}::text,
              'monitoring_detected'::varchar,
              ${alert.message}::text,
              true
            )
          `;
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







