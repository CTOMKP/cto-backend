import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import axios, { AxiosResponse, AxiosInstance } from 'axios';
import { createSafeFetcher } from '../utils/safe-fetcher';

export interface DexScreenerTokenData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

export interface GMGNTokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply: string;
  price: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  creator: {
    address: string;
    balance: number;
    status: string;
  };
  topHolders: Array<{
    address: string;
    balance: number;
    percentage: number;
  }>;
  socials: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

@Injectable()
export class ExternalApisService {
  private readonly logger = new Logger(ExternalApisService.name);
  private moralis: AxiosInstance;
  private solscan: AxiosInstance;
  private readonly solscanApiKey: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    const moralisApiKey = this.configService.get('MORALIS_API_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjlhYjA0YmUzLWQ0MTgtNGI3OS04ZTI0LTg2ZjFhODQyMGNlNCIsIm9yZ0lkIjoiNDg3OTczIiwidXNlcklkIjoiNTAyMDU5IiwidHlwZUlkIjoiMWJmZWVhYTctMDgyMi00NzIxLWE4YzYtMWNiYTVjYmMwZmY0IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NjcwMzk0NzMsImV4cCI6NDkyMjc5OTQ3M30.9ueViJafyhOTlF637oKifhOvsowP9CP02HIWp9yCslI');
    this.solscanApiKey = this.configService.get('SOLSCAN_API_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjcmVhdGVkQXQiOjE3NjcwMzk4ODY5MDMsImVtYWlsIjoiYmFudGVyY29wQGdtYWlsLmNvbSIsImFjdGlvbiI6InRva2VuLWFwaSIsImFwaVZlcnNpb24iOiJ2MiIsImlhdCI6MTc2NzAzOTg4Nn0.MHywPv97_xkaaTrhef5B7WsY3kCcOGvIIS3jZUBrat0');

    this.moralis = createSafeFetcher('https://solana-gateway.moralis.io/token/mainnet/', moralisApiKey, 'X-API-Key');
    
    // Solscan V2 Pro keys (JWT) require 'x-api-key', Old V1 keys require 'token'
    const isV2 = solscanApiKey?.startsWith('eyJ');
    this.solscan = createSafeFetcher(
      isV2 ? 'https://pro-api.solscan.io/v2/' : 'https://api.solscan.io/',
      solscanApiKey,
      isV2 ? 'x-api-key' : 'token'
    );
  }

  /**
   * Fetch token data from DexScreener
   */
  async fetchDexScreenerData(contractAddress: string, chain: string = 'solana'): Promise<DexScreenerTokenData | null> {
    try {
      const apiUrl = this.configService.get('DEXSCREENER_URL', 'https://api.dexscreener.com/latest');
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${apiUrl}/dex/tokens/${contractAddress}`)
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0]; // Get the first (most liquid) pair
        return this.transformDexScreenerData(pair);
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch DexScreener data for ${contractAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch token data from GMGN
   */
  async fetchGMGNData(contractAddress: string): Promise<GMGNTokenData | null> {
    try {
      // GMGN doesn't have a direct API, we'll use Apify scrapers instead
      // This method is kept for compatibility but will return null
      this.logger.debug(`GMGN data will be fetched via Apify scrapers for ${contractAddress}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to fetch GMGN data for ${contractAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch token data using Apify scrapers
   */
  async fetchApifyData(contractAddress: string, chain: string = 'solana') {
    try {
      const apifyApiKey = this.configService.get('APIFY_API_KEY');
      if (!apifyApiKey) {
        this.logger.debug('Apify API key not configured, skipping Apify data fetch');
        return {
          dexScreener: null,
          gmgnTraders: null,
          gmgnStats: null,
        };
      }

      const baseUrl = 'https://api.apify.com/v2/acts';
      // For now, return null to avoid API rate limits during testing
      // In production, uncomment the following lines:
      /*
      const [dexScreenerData, gmgnTradersData, gmgnStatsData] = await Promise.allSettled([
        this.fetchApifyDexScreenerData(contractAddress, chain, apifyApiKey, baseUrl),
        this.fetchApifyGMGNTradersData(contractAddress, apifyApiKey, baseUrl),
        this.fetchApifyGMGNStatsData(contractAddress, apifyApiKey, baseUrl),
      ]);

      return {
        dexScreener: dexScreenerData.status === 'fulfilled' ? dexScreenerData.value : null,
        gmgnTraders: gmgnTradersData.status === 'fulfilled' ? gmgnTradersData.value : null,
        gmgnStats: gmgnStatsData.status === 'fulfilled' ? gmgnStatsData.value : null,
      };
      */

      return {
        dexScreener: null,
        gmgnTraders: null,
        gmgnStats: null,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Apify data for ${contractAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Fetch token data from Moralis
   */
  async fetchMoralisData(contractAddress: string, chain: string = 'solana') {
    try {
      // Use Solana specialized gateway for Moralis if chain is Solana
      const isSolana = chain.toLowerCase() === 'solana';
      
      const url = isSolana
        ? `${contractAddress}/metadata`
        : `token/${chain.toLowerCase()}/${contractAddress}/metadata`;

      const response = await this.moralis.get(url);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Moralis data for ${contractAddress}:`, error.message);
      if (error instanceof HttpException) throw error;
      return null;
    }
  }

  /**
   * Fetch token data from Solscan
   */
  async fetchSolscanData(contractAddress: string) {
    try {
      const isV2 = this.solscanApiKey?.startsWith('eyJ');
      const url = isV2 
        ? `token/meta?address=${contractAddress}`
        : `token/meta?token=${contractAddress}`;

      const response = await this.solscan.get(url);
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to fetch Solscan data for ${contractAddress}:`, error.message);
      if (error instanceof HttpException) throw error;
      return null;
    }
  }

  /**
   * Fetch token data from Etherscan
   */
  async fetchEtherscanData(contractAddress: string) {
    try {
      const apiKey = this.configService.get('ETHERSCAN_API_KEY');
      if (!apiKey) {
        this.logger.debug('Etherscan API key not configured');
        return null;
      }

      const apiUrl = this.configService.get('ETHERSCAN_API_URL', 'https://api.etherscan.io/api');
      
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(apiUrl, {
          params: {
            module: 'token',
            action: 'tokeninfo',
            contractaddress: contractAddress,
            apikey: apiKey,
          },
        })
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch Etherscan data for ${contractAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Combine data from multiple sources
   */
  async fetchCombinedTokenData(contractAddress: string, chain: string = 'solana') {
    this.logger.debug(`Fetching combined data for token: ${contractAddress}`);

    try {
      // Fetch data from multiple sources in parallel
      const [dexScreenerData, gmgnData, moralisData, solscanData, apifyData] = await Promise.allSettled([
        this.fetchDexScreenerData(contractAddress, chain),
        this.fetchGMGNData(contractAddress),
        this.fetchMoralisData(contractAddress, chain),
        chain === 'solana' ? this.fetchSolscanData(contractAddress) : Promise.resolve(null),
        this.fetchApifyData(contractAddress, chain),
      ]);

      return {
        contractAddress,
        chain,
        dexScreener: dexScreenerData.status === 'fulfilled' ? dexScreenerData.value : null,
        gmgn: gmgnData.status === 'fulfilled' ? gmgnData.value : null,
        moralis: moralisData.status === 'fulfilled' ? moralisData.value : null,
        solscan: solscanData.status === 'fulfilled' ? solscanData.value : null,
        apify: apifyData.status === 'fulfilled' ? apifyData.value : null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch combined data for ${contractAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Transform DexScreener data to our format
   */
  private transformDexScreenerData(pair: any): DexScreenerTokenData {
    return {
      chainId: pair.chainId,
      dexId: pair.dexId,
      url: pair.url,
      pairAddress: pair.pairAddress,
      baseToken: {
        address: pair.baseToken.address,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        decimals: pair.baseToken.decimals,
      },
      quoteToken: {
        address: pair.quoteToken.address,
        name: pair.quoteToken.name,
        symbol: pair.quoteToken.symbol,
        decimals: pair.quoteToken.decimals,
      },
      priceNative: pair.priceNative,
      priceUsd: pair.priceUsd,
      txns: {
        m5: pair.txns?.m5 || { buys: 0, sells: 0 },
        h1: pair.txns?.h1 || { buys: 0, sells: 0 },
        h6: pair.txns?.h6 || { buys: 0, sells: 0 },
        h24: pair.txns?.h24 || { buys: 0, sells: 0 },
      },
      volume: {
        h24: pair.volume?.h24 || 0,
        h6: pair.volume?.h6 || 0,
        h1: pair.volume?.h1 || 0,
        m5: pair.volume?.m5 || 0,
      },
      priceChange: {
        m5: pair.priceChange?.m5 || 0,
        h1: pair.priceChange?.h1 || 0,
        h6: pair.priceChange?.h6 || 0,
        h24: pair.priceChange?.h24 || 0,
      },
      liquidity: {
        usd: pair.liquidity?.usd || 0,
        base: pair.liquidity?.base || 0,
        quote: pair.liquidity?.quote || 0,
      },
      fdv: pair.fdv || 0,
      marketCap: pair.marketCap || 0,
      pairCreatedAt: pair.pairCreatedAt || 0,
    };
  }
}


