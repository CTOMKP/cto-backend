import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { createSafeFetcher } from '../../utils/safe-fetcher';
import { ConfigService } from '@nestjs/config';

/**
 * AnalyticsService
 * ----------------
 * Provides holder count and transfer analytics with multi-API fallback strategy.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  
  private readonly etherscanApiKey: string;
  private readonly moralisApiKey: string;
  private readonly heliusApiKey: string;
  private readonly solscanApiKey: string;
  private readonly bitqueryToken: string;

  private readonly moralis: any;
  private readonly solscan: any;
  private readonly helius: any;

  constructor(private readonly configService: ConfigService) {
    this.etherscanApiKey = this.configService.get('ETHERSCAN_API_KEY');
    this.moralisApiKey = this.configService.get('MORALIS_API_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjlhYjA0YmUzLWQ0MTgtNGI3OS04ZTI0LTg2ZjFhODQyMGNlNCIsIm9yZ0lkIjoiNDg3OTczIiwidXNlcklkIjoiNTAyMDU5IiwidHlwZUlkIjoiMWJmZWVhYTctMDgyMi00NzIxLWE4YzYtMWNiYTVjYmMwZmY0IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjcwMzk0NzMsImV4cCI6NDkyMjc5OTQ3M30.9ueViJafyhOTlF637oKifhOvsowP9CP02HIWp9yCslI');
    this.heliusApiKey = this.configService.get('HELIUS_API_KEY', '1485e891-c87d-40e1-8850-a578511c4b92');
    this.solscanApiKey = this.configService.get('SOLSCAN_API_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjcmVhdGVkQXQiOjE3NjcwMzk4ODY5MDMsImVtYWlsIjoiYmFudGVyY29wQGdtYWlsLmNvbSIsImFjdGlvbiI6InRva2VuLWFwaSIsImFwaVZlcnNpb24iOiJ2MiIsImlhdCI6MTc2NzAzOTg4Nn0.MHywPv97_xkaaTrhef5B5WsY3kCcOGvIIS3jZUBrat0');
    this.bitqueryToken = this.configService.get('BITQUERY_ACCESS_TOKEN');

    // Initialize resilient fetchers
    this.moralis = createSafeFetcher('https://solana-gateway.moralis.io/token/mainnet/', this.moralisApiKey, 'X-API-Key');
    
    // Solscan V2 Pro keys (JWT) require 'x-api-key', Old V1 keys require 'token'
    const isV2 = this.solscanApiKey?.startsWith('eyJ');
    this.solscan = createSafeFetcher(
      isV2 ? 'https://pro-api.solscan.io/v2/' : 'https://api.solscan.io/',
      this.solscanApiKey,
      isV2 ? 'x-api-key' : 'token'
    );

    this.helius = createSafeFetcher('https://mainnet.helius-rpc.com/', this.heliusApiKey, 'x-api-key');
  }

  /**
   * Get holder count with multi-API fallback
   */
  async getHolderCount(contractAddress: string, chain: string): Promise<number | null> {
    this.logger.log(`Fetching holder count for ${contractAddress} on ${chain}`);

    // Try Etherscan for Ethereum tokens
    if (chain === 'ETHEREUM' && this.etherscanApiKey) {
      const holders = await this.getEtherscanHolders(contractAddress);
      if (holders !== null) {
        this.logger.log(`✅ Etherscan returned ${holders} holders`);
        return holders;
      }
    }

    // Try Moralis for multi-chain support
    if (this.moralisApiKey) {
      const holders = await this.getMoralisHolders(contractAddress, chain);
      if (holders !== null) {
        this.logger.log(`✅ Moralis returned ${holders} holders`);
        return holders;
      }
    }

    // Try Helius for Solana tokens
    if (chain === 'SOLANA' && this.heliusApiKey) {
      const holders = await this.getHeliusHolders(contractAddress);
      if (holders !== null) {
        this.logger.log(`✅ Helius returned ${holders} holders`);
        return holders;
      }
    }

    // Try Solscan for Solana tokens (with API key)
    if (chain === 'SOLANA' && this.solscanApiKey) {
      const holders = await this.getSolscanHolders(contractAddress);
      if (holders !== null) {
        this.logger.log(`✅ Solscan (API key) returned ${holders} holders`);
        return holders;
      }
    }

    this.logger.warn(`❌ No holder data available for ${contractAddress} on ${chain}`);
    return null;
  }

  /**
   * Etherscan API - Get token holder count
   */
  private async getEtherscanHolders(contractAddress: string): Promise<number | null> {
    try {
      const url = `https://api.etherscan.io/api?module=token&action=tokenholdercount&contractaddress=${contractAddress}&apikey=${this.etherscanApiKey}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data?.status === '1' && response.data?.result) {
        return parseInt(response.data.result, 10);
      }
      
      return null;
    } catch (error: any) {
      this.logger.debug(`Etherscan API error: ${error.message}`);
      return null;
    }
  }

  /**
   * Moralis API - Get token holders (multi-chain)
   */
  private async getMoralisHolders(contractAddress: string, chain: string): Promise<number | null> {
    try {
      if (chain !== 'SOLANA') {
        // Fallback for EVM if needed, but the primary focus is Solana for now
        return null;
      }

      const response = await this.moralis.get(`${contractAddress}/owners?limit=1`);
      return response.data?.total || response.data?.count || null;
    } catch (error: any) {
      this.logger.debug(`Moralis API error: ${error.message}`);
      if (error instanceof HttpException) throw error;
      return null;
    }
  }

  /**
   * Helius API - Get Solana token holder count
   */
  private async getHeliusHolders(contractAddress: string): Promise<number | null> {
    try {
      const response = await this.helius.post('', {
        jsonrpc: '2.0',
        id: 'get-holders',
        method: 'getTokenAccounts',
        params: [
          { mint: contractAddress },
          { page: 1, limit: 1, displayOptions: { showSummary: true } },
        ],
      });

      return response.data?.result?.total || null;
    } catch (error: any) {
      this.logger.debug(`Helius API error: ${error.message}`);
      if (error instanceof HttpException) throw error;
      return null;
    }
  }

  /**
   * Solscan API - Get Solana token holders
   */
  private async getSolscanHolders(contractAddress: string): Promise<number | null> {
    try {
      const isV2 = this.solscanApiKey?.startsWith('eyJ');
      const response = await this.solscan.get(isV2 
        ? `token/holders?address=${contractAddress}&page=1&page_size=1`
        : `token/holders?token=${contractAddress}&offset=0&size=1`
      );

      return response.data?.total || response.data?.data?.total || null;
    } catch (error: any) {
      this.logger.debug(`Solscan API error: ${error.message}`);
      if (error instanceof HttpException) throw error;
      return null;
    }
  }

  /**
   * Get token transfer analytics via Bitquery
   */
  async getTransferAnalytics(contractAddress: string, chain: string): Promise<any> {
    if (!this.bitqueryToken) {
      this.logger.warn('Bitquery access token not configured');
      return null;
    }

    try {
      // Map chain to Bitquery network identifier
      const networkMap: Record<string, string> = {
        'ETHEREUM': 'ethereum',
        'BSC': 'bsc',
        'POLYGON': 'matic',
        'AVALANCHE': 'avalanche',
        'SOLANA': 'solana',
      };

      const network = networkMap[chain] || 'ethereum';

      const query = `
        query ($token: String!, $network: String!) {
          ${network}(network: ${network}) {
            transfers(currency: {is: $token}, options: {limit: 100, desc: "block.height"}) {
              block {
                height
                timestamp {
                  time(format: "%Y-%m-%d %H:%M:%S")
                }
              }
              amount
              sender {
                address
              }
              receiver {
                address
              }
              transaction {
                hash
              }
            }
          }
        }
      `;

      const response = await axios.post(
        'https://graphql.bitquery.io',
        {
          query,
          variables: {
            token: contractAddress,
            network: network,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.bitqueryToken}`,
          },
          timeout: 10000,
        }
      );

      if (response.data?.data?.[network]?.transfers) {
        const transfers = response.data.data[network].transfers;
        
        // Calculate buy/sell ratio
        const analytics = this.calculateTransferAnalytics(transfers);
        
        this.logger.log(`✅ Bitquery returned ${transfers.length} transfers`);
        return {
          transfers: transfers.slice(0, 10), // Return last 10 transfers
          analytics,
        };
      }

      this.logger.debug(`Bitquery returned no transfer data`);
      return null;
    } catch (error: any) {
      this.logger.debug(`Bitquery API error: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate analytics from transfer data
   */
  private calculateTransferAnalytics(transfers: any[]): any {
    if (!transfers || transfers.length === 0) {
      return {
        totalTransfers: 0,
        buyCount: 0,
        sellCount: 0,
        netBuyRatio: 0,
        totalVolume: 0,
      };
    }

    // Simple heuristic: transfers to DEX addresses are sells, from DEX are buys
    const dexAddresses = new Set([
      // Add known DEX router addresses here
      '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
      '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3
      '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch
    ]);

    let buyCount = 0;
    let sellCount = 0;
    let totalVolume = 0;

    transfers.forEach((transfer: any) => {
      const amount = parseFloat(transfer.amount || 0);
      totalVolume += amount;

      const senderLower = transfer.sender?.address?.toLowerCase();
      const receiverLower = transfer.receiver?.address?.toLowerCase();

      if (dexAddresses.has(senderLower)) {
        buyCount++;
      } else if (dexAddresses.has(receiverLower)) {
        sellCount++;
      }
    });

    const totalTrades = buyCount + sellCount;
    const netBuyRatio = totalTrades > 0 ? (buyCount - sellCount) / totalTrades : 0;

    return {
      totalTransfers: transfers.length,
      buyCount,
      sellCount,
      netBuyRatio: Math.round(netBuyRatio * 100) / 100,
      totalVolume: Math.round(totalVolume * 100) / 100,
    };
  }

  /**
   * Get OHLCV data for charting
   * Priority: Birdeye (Solana) → DexScreener (generate from current) → Empty
   */
  async getOHLCVData(contractAddress: string, chain: string, timeframe: string = '1h'): Promise<any[]> {
    try {
      this.logger.log(`Getting OHLCV data for ${contractAddress} on ${chain}`);
      
      // For Solana tokens, try Birdeye API (has historical data)
      if (chain.toUpperCase() === 'SOLANA') {
        try {
          const birdeyeUrl = `https://public-api.birdeye.so/defi/ohlcv?address=${contractAddress}&type=${timeframe}&time_from=${Math.floor(Date.now() / 1000) - 86400}&time_to=${Math.floor(Date.now() / 1000)}`;
          this.logger.log(`Trying Birdeye API: ${birdeyeUrl}`);
          const birdeyeResponse = await axios.get(birdeyeUrl, {
            headers: {
              'X-API-KEY': process.env.BIRDEYE_API_KEY || 'public',
            },
            timeout: 5000,
          });

          if (birdeyeResponse.data?.data?.items && birdeyeResponse.data.data.items.length > 0) {
            this.logger.log(`Birdeye returned ${birdeyeResponse.data.data.items.length} candles`);
            return birdeyeResponse.data.data.items.map((item: any) => ({
              time: item.unixTime,
              open: parseFloat(item.o || 0),
              high: parseFloat(item.h || 0),
              low: parseFloat(item.l || 0),
              close: parseFloat(item.c || 0),
              volume: parseFloat(item.v || 0),
            }));
          }
        } catch (birdeyeError) {
          this.logger.debug(`Birdeye API failed: ${birdeyeError.message}, falling back to DexScreener`);
        }
      }

      // Fallback: Use DexScreener to get current price and generate historical data
      this.logger.log(`Falling back to DexScreener for ${contractAddress}`);
      const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
      const response = await axios.get(url, { timeout: 5000 });

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const currentPrice = parseFloat(pair.priceUsd || 0);
        const volume24h = parseFloat(pair.volume?.h24 || 0);
        const priceChange24h = parseFloat(pair.priceChange?.h24 || 0);

        this.logger.log(`DexScreener data: price=${currentPrice}, volume=${volume24h}, change=${priceChange24h}%`);

        if (currentPrice > 0) {
          // Generate 24 hours of hourly candles based on current price and 24h change
          const candles = [];
          const now = Math.floor(Date.now() / 1000);
          const hoursToGenerate = 24;
          
          // Calculate starting price from 24h change
          const startPrice = currentPrice / (1 + priceChange24h / 100);
          
          for (let i = hoursToGenerate; i >= 0; i--) {
            const time = now - (i * 3600); // 1 hour intervals
            const progress = (hoursToGenerate - i) / hoursToGenerate;
            
            // Interpolate price with some randomness for realistic candles
            const basePrice = startPrice + (currentPrice - startPrice) * progress;
            const volatility = basePrice * 0.02; // 2% volatility
            
            const open = basePrice + (Math.random() - 0.5) * volatility;
            const close = basePrice + (Math.random() - 0.5) * volatility;
            const high = Math.max(open, close) + Math.random() * volatility * 0.5;
            const low = Math.min(open, close) - Math.random() * volatility * 0.5;
            
            candles.push({
              time,
              open: Math.max(0, open),
              high: Math.max(0, high),
              low: Math.max(0, low),
              close: Math.max(0, close),
              volume: volume24h / hoursToGenerate,
            });
          }
          
          this.logger.log(`Generated ${candles.length} synthetic candles`);
          return candles;
        }
      }

      this.logger.warn(`No chart data available for ${contractAddress}`);
      return [];
    } catch (error: any) {
      this.logger.error(`OHLCV data fetch error: ${error.message}`);
      return [];
    }
  }
}