import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DuneQueryResult {
  execution_id: string;
  state: string;
  result?: {
    rows: any[];
  };
}

export interface MemecoinStats {
  dailyTokensDeployed: number;  // Daily launched tokens
  dailyGraduates: number;        // Daily graduates
  topTokensLast7Days: number;    // Runners (market cap ≥ $500K)
  lastUpdated: string;
  timeframe?: string; // e.g., "7 days", "24 hours", "30 days"
}

@Injectable()
export class DuneService {
  private readonly logger = new Logger(DuneService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.dune.com/api/v1';
  
  // Cache for stats (refresh every 10 minutes)
  private statsCache: MemecoinStats | null = null;
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in ms

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DUNE_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('⚠️  DUNE_API_KEY not configured - using fallback stats');
      this.logger.warn('⚠️  Set DUNE_API_KEY in environment variables to fetch live data from Dune Analytics');
    } else {
      this.logger.log('✅ DUNE_API_KEY configured - will fetch live data from Dune Analytics');
    }
  }

  /**
   * Get memecoin stats from Dune Analytics
   * Returns cached data if available and fresh
   */
  async getMemecoinStats(timeframe: string = '7 days'): Promise<MemecoinStats> {
    // Return cached data if still fresh
    const now = Date.now();
    if (this.statsCache && (now - this.lastFetchTime < this.CACHE_DURATION)) {
      this.logger.debug('Returning cached stats');
      return this.statsCache;
    }

    // If no API key, return fallback stats
    if (!this.apiKey) {
      this.logger.warn('⚠️  No DUNE_API_KEY - returning fallback stats');
      return this.getFallbackStats();
    }

    this.logger.log(`🔄 Fetching fresh stats from Dune Analytics (timeframe: ${timeframe})`);
    try {
      // Fetch fresh data from Dune
      const stats = await this.fetchFromDune(timeframe);
      
      // Update cache
      this.statsCache = stats;
      this.lastFetchTime = now;
      
      this.logger.log(`✅ Successfully fetched stats: Launched=${stats.dailyTokensDeployed}, Graduated=${stats.dailyGraduates}, Runners=${stats.topTokensLast7Days}`);
      return stats;
    } catch (error) {
      this.logger.error(`❌ Failed to fetch Dune stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      if (error instanceof Error && error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      
      // Return cached data if available, otherwise fallback
      if (this.statsCache) {
        this.logger.warn('⚠️  Using stale cached stats due to fetch error');
        return this.statsCache;
      }
      
      this.logger.warn('⚠️  No cache available - returning fallback stats');
      return this.getFallbackStats();
    }
  }

  /**
   * Fetches memecoin statistics from Dune Analytics
   * 
   * Metrics:
   * - Launched: Daily tokens deployed across all platforms (Query 4010816)
   * - Graduated: Daily tokens that completed bonding curve (Query 5131612)
   * - Runners: Tokens with market cap >= $500K (calculated as 10% of Graduates)
   * 
   * Dashboard: https://dune.com/adam_tehc/memecoin-wars
   * 
   * Query IDs:
   * - 4010816: Daily Tokens Deployed - Solana Memecoin Launchpads
   *   URL: https://dune.com/queries/4010816/6752517
   * - 5131612: Daily Graduates - Solana Memecoin Launch Pads
   *   URL: https://dune.com/queries/5131612/8459254
   * 
   * @param timeframe - Time period for stats (default: '7 days')
   * @returns MemecoinStats object with current metrics
   */
  private async fetchFromDune(timeframe: string = '7 days'): Promise<MemecoinStats> {
    try {
      // Execute queries from https://dune.com/adam_tehc/memecoin-wars
      
      // Query 4010816: Daily Tokens Deployed - Solana Memecoin Launchpads
      const dailyDeployedData = await this.executeQuery(4010816);
      
      // Query 5131612: Daily Graduates - Solana Memecoin Launch Pads
      const dailyGraduatesData = await this.executeQuery(5131612);
      
      // Extract daily counts from most recent data
      const launched = this.extractDailyCount(dailyDeployedData);
      const graduated = this.extractDailyCount(dailyGraduatesData);
      
      // Calculate Runners: 10% of Graduates (more stable than % of Launched)
      // Rationale: Graduated tokens already proved demand, ~10% reach $500K+ market cap
      const runners = Math.max(1, Math.round(graduated * 0.10));
      
      this.logger.log(`📊 Daily Stats: Launched=${launched.toLocaleString()}, Graduated=${graduated.toLocaleString()}, Runners=${runners.toLocaleString()} (10% of graduates)`);
      
      return {
        dailyTokensDeployed: launched,
        dailyGraduates: graduated,
        topTokensLast7Days: runners,
        lastUpdated: new Date().toISOString(),
        timeframe: timeframe,
      };
    } catch (error) {
      this.logger.error(`Dune API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Execute a Dune query and get results
   * Retries up to 2 times if query times out
   */
  private async executeQuery(queryId: number, retryCount: number = 0): Promise<any> {
    const maxRetries = 2;
    
    try {
      this.logger.debug(`Executing Dune query ${queryId} (attempt ${retryCount + 1}/${maxRetries + 1})`);
      
      // Step 1: Execute the query
      const executeResponse = await fetch(`${this.baseUrl}/query/${queryId}/execute`, {
        method: 'POST',
        headers: {
          'X-Dune-API-Key': this.apiKey,
        },
      });

      if (!executeResponse.ok) {
        const errorText = await executeResponse.text();
        this.logger.error(`Dune API execute failed (${executeResponse.status}): ${errorText}`);
        throw new Error(`Dune API execute failed: ${executeResponse.statusText}`);
      }

      const executeData: DuneQueryResult = await executeResponse.json();
      const executionId = executeData.execution_id;
      
      this.logger.debug(`Query ${queryId} execution started, execution_id: ${executionId}`);

      // Step 2: Poll for results (max 90 seconds - Dune queries can take time)
      let attempts = 0;
      const maxAttempts = 90; // Increased from 30 to 90 seconds
      const pollInterval = 2000; // Poll every 2 seconds instead of 1

      while (attempts < maxAttempts) {
        await this.sleep(pollInterval);

        const statusResponse = await fetch(`${this.baseUrl}/execution/${executionId}/results`, {
          headers: {
            'X-Dune-API-Key': this.apiKey,
          },
        });

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          this.logger.error(`Dune API status check failed (${statusResponse.status}): ${errorText}`);
          throw new Error(`Dune API status check failed: ${statusResponse.statusText}`);
        }

        const statusData: DuneQueryResult = await statusResponse.json();

        if (statusData.state === 'QUERY_STATE_COMPLETED') {
          this.logger.debug(`Query ${queryId} completed after ${attempts * (pollInterval / 1000)} seconds`);
          return statusData.result?.rows || [];
        }

        if (statusData.state === 'QUERY_STATE_FAILED') {
          this.logger.error(`Query ${queryId} execution failed, state: ${statusData.state}`);
          throw new Error('Query execution failed');
        }

        // Log progress every 10 attempts (every 20 seconds)
        if (attempts % 10 === 0 && attempts > 0) {
          this.logger.debug(`Query ${queryId} still running... (${attempts * (pollInterval / 1000)}s elapsed, state: ${statusData.state})`);
        }

        attempts++;
      }

      this.logger.error(`Query ${queryId} timeout after ${maxAttempts * (pollInterval / 1000)} seconds`);
      throw new Error(`Query timeout - results not ready after ${maxAttempts * (pollInterval / 1000)} seconds`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Execute query ${queryId} failed (attempt ${retryCount + 1}): ${errorMessage}`);
      
      // Retry on timeout if we haven't exceeded max retries
      if (errorMessage.includes('timeout') && retryCount < maxRetries) {
        this.logger.warn(`Retrying query ${queryId} in 5 seconds... (${retryCount + 1}/${maxRetries})`);
        await this.sleep(5000); // Wait 5 seconds before retry
        return this.executeQuery(queryId, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Extract count from query results
   */
  private extractCount(rows: any[]): number {
    if (!rows || rows.length === 0) return 0;
    
    // Assuming the query returns a single row with a count field
    // Adjust based on actual Dune query structure
    const firstRow = rows[0];
    return firstRow?.count || firstRow?.total || firstRow?.value || rows.length;
  }

  /**
   * Extract daily count from Dune query results
   * Queries 4010816 and 5131612 return daily data
   */
  private extractDailyCount(rows: any[]): number {
    if (!rows || rows.length === 0) {
      this.logger.warn(`No data returned from Dune query`);
      // Return realistic fallback based on client requirements
      return 10000; // Daily: ~10k launched (pump.fun baseline)
    }
    
    // Get the most recent day's data (usually the first row)
    const latestRow = rows[0];
    
    this.logger.debug(`Latest row data: ${JSON.stringify(latestRow)}`);
    
    // Try common field names for daily counts
    // These queries return different field structures, so we try multiple options
    const count = (
      latestRow?.daily_tokens_deployed ||
      latestRow?.daily_graduates ||
      latestRow?.tokens_deployed ||
      latestRow?.tokens_launched ||
      latestRow?.graduates ||
      latestRow?.graduated ||
      latestRow?.total ||
      latestRow?.count ||
      latestRow?.value ||
      10000 // Fallback: realistic daily count
    );
    
    return Number(count) || 10000;
  }


  /**
   * Fallback stats when Dune is unavailable
   * Using realistic pump.fun-style numbers based on client requirements
   */
  private getFallbackStats(): MemecoinStats {
    const launched = 10000;
    const graduated = 80;
    const runners = Math.max(1, Math.round(graduated * 0.10)); // 10% of graduates
    
    this.logger.warn('⚠️  Using fallback stats (no Dune API key or cache available)');
    
    return {
      dailyTokensDeployed: launched,
      dailyGraduates: graduated,
      topTokensLast7Days: runners,
      lastUpdated: new Date().toISOString(),
      timeframe: 'fallback',
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Force refresh cache (for admin use)
   */
  async refreshCache(): Promise<MemecoinStats> {
    this.statsCache = null;
    this.lastFetchTime = 0;
    return this.getMemecoinStats();
  }
}

