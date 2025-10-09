import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DuneQueryResult {
  execution_id: string;
  state: string;
  result?: {
    rows: any[];
  };
}

interface MemecoinStats {
  dailyTokensDeployed: number;
  dailyGraduates: number;
  topTokensLast7Days: number;
  lastUpdated: string;
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
    }
  }

  /**
   * Get memecoin stats from Dune Analytics
   * Returns cached data if available and fresh
   */
  async getMemecoinStats(): Promise<MemecoinStats> {
    // Return cached data if still fresh
    const now = Date.now();
    if (this.statsCache && (now - this.lastFetchTime < this.CACHE_DURATION)) {
      this.logger.debug('Returning cached stats');
      return this.statsCache;
    }

    // If no API key, return fallback stats
    if (!this.apiKey) {
      return this.getFallbackStats();
    }

    try {
      // Fetch fresh data from Dune
      const stats = await this.fetchFromDune();
      
      // Update cache
      this.statsCache = stats;
      this.lastFetchTime = now;
      
      return stats;
    } catch (error) {
      this.logger.error(`Failed to fetch Dune stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Return cached data if available, otherwise fallback
      if (this.statsCache) {
        this.logger.warn('Using stale cached stats due to fetch error');
        return this.statsCache;
      }
      
      return this.getFallbackStats();
    }
  }

  /**
   * Fetch data from Dune Analytics API
   * Query IDs from: https://dune.com/adam_tehc/memecoin-wars
   */
  private async fetchFromDune(): Promise<MemecoinStats> {
    try {
      // Execute query for daily tokens deployed
      const dailyDeployed = await this.executeQuery(4301519); // Replace with actual query ID
      
      // Execute query for daily graduates
      const dailyGraduates = await this.executeQuery(4301520); // Replace with actual query ID
      
      // Execute query for top tokens last 7 days
      const topTokens = await this.executeQuery(4301521); // Replace with actual query ID
      
      return {
        dailyTokensDeployed: this.extractCount(dailyDeployed),
        dailyGraduates: this.extractCount(dailyGraduates),
        topTokensLast7Days: this.extractCount(topTokens),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Dune API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Execute a Dune query and get results
   */
  private async executeQuery(queryId: number): Promise<any> {
    try {
      // Step 1: Execute the query
      const executeResponse = await fetch(`${this.baseUrl}/query/${queryId}/execute`, {
        method: 'POST',
        headers: {
          'X-Dune-API-Key': this.apiKey,
        },
      });

      if (!executeResponse.ok) {
        throw new Error(`Dune API execute failed: ${executeResponse.statusText}`);
      }

      const executeData: DuneQueryResult = await executeResponse.json();
      const executionId = executeData.execution_id;

      // Step 2: Poll for results (max 30 seconds)
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        await this.sleep(1000); // Wait 1 second between polls

        const statusResponse = await fetch(`${this.baseUrl}/execution/${executionId}/results`, {
          headers: {
            'X-Dune-API-Key': this.apiKey,
          },
        });

        if (!statusResponse.ok) {
          throw new Error(`Dune API status check failed: ${statusResponse.statusText}`);
        }

        const statusData: DuneQueryResult = await statusResponse.json();

        if (statusData.state === 'QUERY_STATE_COMPLETED') {
          return statusData.result?.rows || [];
        }

        if (statusData.state === 'QUERY_STATE_FAILED') {
          throw new Error('Query execution failed');
        }

        attempts++;
      }

      throw new Error('Query timeout - results not ready after 30 seconds');
    } catch (error) {
      this.logger.error(`Execute query ${queryId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
   * Fallback stats when Dune is unavailable
   */
  private getFallbackStats(): MemecoinStats {
    return {
      dailyTokensDeployed: 100,
      dailyGraduates: 100,
      topTokensLast7Days: 100,
      lastUpdated: new Date().toISOString(),
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

