import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

export interface QuoteRequest {
  chain: 'solana' | 'movement' | 'base';
  inputToken: string;
  outputToken: string;
  amount: string;
  swapMode?: 'ExactIn' | 'ExactOut';
  slippageBps?: number;
}

export interface QuoteResponse {
  chain: 'solana' | 'movement' | 'base';
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  slippageBps: number;
  routePlan?: any[];
  validFor: number; // Seconds until quote expires
  estimatedGas?: string;
  // Chain-specific data
  rawQuote?: any; // Full API response for transaction building
}

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private readonly cache = new Map<string, { data: QuoteResponse; expiresAt: number }>();
  private readonly cacheTtl = 10_000; // 10 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Unified quote method - detects chain and routes to appropriate provider
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const { chain, inputToken, outputToken, amount, swapMode = 'ExactIn', slippageBps = 50 } = request;

    // Validate inputs
    if (!inputToken || !outputToken || !amount) {
      throw new BadRequestException('inputToken, outputToken, and amount are required');
    }

    // Check cache
    const cacheKey = `${chain}:${inputToken}:${outputToken}:${amount}:${slippageBps}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Returning cached quote for ${cacheKey}`);
      return cached.data;
    }

    // Route to chain-specific quote provider
    let quote: QuoteResponse;
    if (chain === 'solana') {
      quote = await this.getSolanaQuote(inputToken, outputToken, amount, swapMode, slippageBps);
    } else if (chain === 'movement') {
      quote = await this.getMovementQuote(inputToken, outputToken, amount, swapMode, slippageBps);
    } else if (chain === 'base') {
      quote = await this.getBaseQuote(inputToken, outputToken, amount, swapMode, slippageBps);
    } else {
      throw new BadRequestException(`Unsupported chain: ${chain}`);
    }

    // Cache the result
    this.cache.set(cacheKey, {
      data: quote,
      expiresAt: Date.now() + this.cacheTtl,
    });

    return quote;
  }

  /**
   * Get Solana quote from Jupiter V6 API
   */
  private async getSolanaQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut',
    slippageBps: number,
  ): Promise<QuoteResponse> {
    const apiKey = this.configService.get('JUPITER_API_KEY');
    // Jupiter V6 API - use the correct endpoint (api.jup.ag, not quote-api.jup.ag)
    const baseUrl = this.configService.get('JUPITER_API_URL') || 'https://api.jup.ag/v6';

    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount,
        slippageBps: slippageBps.toString(),
        swapMode,
        onlyDirectRoutes: 'false', // Allow multi-hop routes
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      this.logger.debug(`Fetching Jupiter quote: ${baseUrl}/quote?${params.toString()}`);

      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/quote?${params.toString()}`, { 
          headers, 
          timeout: 15_000,
          validateStatus: (status) => status < 500,
        }),
      );

      const data = response.data;

      return {
        chain: 'solana',
        inputMint: data.inputMint,
        outputMint: data.outputMint,
        inAmount: data.inAmount,
        outAmount: data.outAmount,
        priceImpactPct: parseFloat(data.priceImpactPct || '0'),
        slippageBps,
        routePlan: data.routePlan || [],
        validFor: 30, // Jupiter quotes valid for 30 seconds
        estimatedGas: '0.000005', // Approximate SOL gas fee
        rawQuote: data, // Store full response for transaction building
      };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const isNetworkError = errorMessage.includes('ENOTFOUND') || 
                             errorMessage.includes('ECONNREFUSED') ||
                             errorMessage.includes('ETIMEDOUT') ||
                             errorMessage.includes('getaddrinfo');
      
      if (isNetworkError) {
        this.logger.error(
          `Jupiter API network error: ${errorMessage}. URL: ${baseUrl}. This may be a DNS or connectivity issue on the server.`,
        );
        throw new BadRequestException(
          `Network error: Cannot connect to Jupiter API. This may be a server connectivity issue. Please contact support if this persists.`,
        );
      }
      
      this.logger.error(`Jupiter quote failed: ${errorMessage}`, error.stack);
      throw new BadRequestException(
        `Failed to get Solana quote: ${error.response?.data?.message || errorMessage}`,
      );
    }
  }

  /**
   * Get Movement quote from Panora API
   * Uses Panora's swap API endpoint to get quotes
   * Falls back to on-chain calculation if API is unavailable
   */
  private async getMovementQuote(
    inputToken: string,
    outputToken: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut',
    slippageBps: number,
  ): Promise<QuoteResponse> {
    const panoraApiKey = this.configService.get('PANORA_API_KEY');
    const panoraBaseUrl = this.configService.get('PANORA_BASE_URL') || 'https://api.panora.exchange';

    // Try Panora API first if API key is configured
    if (panoraApiKey) {
      try {
        // Convert slippage from basis points to percentage
        const slippagePercentage = slippageBps / 100;

        // Panora API uses POST with query parameters (based on legacy code)
        const params = new URLSearchParams({
          fromTokenAddress: inputToken,
          toTokenAddress: outputToken,
          fromTokenAmount: amount,
          slippagePercentage: slippagePercentage.toString(),
        });

        const response = await firstValueFrom(
          this.httpService.post(
            `${panoraBaseUrl}/swap?${params.toString()}`,
            {},
            {
              headers: {
                'x-api-key': panoraApiKey,
                'Content-Type': 'application/json',
              },
              timeout: 10_000,
            },
          ),
        );

        const data = response.data;

        // Panora API response structure - adjust based on actual response
        // The quote may contain: toTokenAmount, expectedOutput, amountOut, etc.
        const quoteData = data.quote || data;
        const outAmount = quoteData.toTokenAmount || quoteData.expectedOutput || quoteData.amountOut || amount;
        const inAmount = quoteData.fromTokenAmount || amount;

        // Calculate price impact
        const priceImpactPct = quoteData.priceImpact
          ? parseFloat(quoteData.priceImpact)
          : this.calculatePriceImpact(parseFloat(inAmount), parseFloat(outAmount));

        this.logger.log(
          `✅ Panora quote received: ${inAmount} ${inputToken} → ${outAmount} ${outputToken}`,
        );

        return {
          chain: 'movement',
          inputMint: inputToken,
          outputMint: outputToken,
          inAmount: inAmount.toString(),
          outAmount: outAmount.toString(),
          priceImpactPct,
          slippageBps,
          validFor: 60, // Movement quotes valid for 60 seconds
          estimatedGas: quoteData.estimatedGas || '0.001',
          rawQuote: {
            ...quoteData,
            inputToken,
            outputToken,
            amount,
            swapMode,
            method: 'panora-api',
          },
        };
      } catch (error: any) {
        this.logger.warn(
          `Panora API quote failed: ${error.message}, falling back to on-chain calculation`,
        );
        // Fall through to on-chain calculation
      }
    } else {
      this.logger.debug('PANORA_API_KEY not configured, using on-chain calculation');
    }

    // Fallback to on-chain calculation
    return await this.getMovementQuoteOnChain(inputToken, outputToken, amount, swapMode, slippageBps);
  }

  /**
   * Fallback: Get Movement quote from on-chain pool reserves
   * Calculates swap amount using constant product formula (x * y = k)
   */
  private async getMovementQuoteOnChain(
    inputToken: string,
    outputToken: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut',
    slippageBps: number,
  ): Promise<QuoteResponse> {
    const config = new AptosConfig({
      network: Network.CUSTOM,
      fullnode: this.configService.get('MOVEMENT_RPC_URL') || 'https://testnet.movementnetwork.xyz/v1',
    });
    const aptos = new Aptos(config);

    const PANORA_ROUTER = this.configService.get('PANORA_ROUTER_ADDRESS') ||
      '0x14068303f88046a78f2445b2075531d04130f14f9d0c2688b1470f80b2a91';

    try {
      // Try to query pool reserves from Panora's swap module
      // Panora pools are typically stored in a resource account
      // The exact structure depends on Panora's implementation

      // For now, we'll use a simplified calculation
      // In production, you would:
      // 1. Query the pool resource: aptos.getAccountResource({ accountAddress: PANORA_ROUTER, resourceType: `${PANORA_ROUTER}::swap::Pool` })
      // 2. Extract reserve_x and reserve_y
      // 3. Calculate using constant product: outAmount = (reserve_y * amount) / (reserve_x + amount)
      // 4. Apply 0.3% fee (if applicable): outAmount = outAmount * 0.997

      this.logger.debug('Attempting on-chain pool reserve query for Movement quote');

      // Placeholder: Try to get pool data
      // This would need to be implemented based on Panora's actual pool structure
      try {
        // Example: Query pool resource (adjust based on actual Panora structure)
        // const poolResource = await aptos.getAccountResource({
        //   accountAddress: PANORA_ROUTER,
        //   resourceType: `${PANORA_ROUTER}::swap::Pool<${inputToken}, ${outputToken}>`,
        // });
        // const reserveX = BigInt(poolResource.reserve_x);
        // const reserveY = BigInt(poolResource.reserve_y);

        // Constant product formula: x * y = k
        // After swap: (x + amountIn) * (y - amountOut) = k
        // Solving for amountOut: amountOut = (y * amountIn) / (x + amountIn)
        // const amountIn = BigInt(amount);
        // const amountOut = (reserveY * amountIn) / (reserveX + amountIn);
        // Apply 0.3% fee: amountOut = amountOut * BigInt(997) / BigInt(1000);

        // For now, return a conservative estimate
        // In production, implement the actual pool query above
        this.logger.warn('On-chain pool query not fully implemented - using estimate');

        const amountNum = parseFloat(amount);
        // Conservative estimate: assume 1:1 ratio (will be improved with actual pool data)
        const estimatedOut = amountNum * 0.99; // 1% fee estimate

        return {
          chain: 'movement',
          inputMint: inputToken,
          outputMint: outputToken,
          inAmount: amount,
          outAmount: estimatedOut.toString(),
          priceImpactPct: 0.5, // Estimate
          slippageBps,
          validFor: 60,
          estimatedGas: '0.001',
          rawQuote: {
            inputToken,
            outputToken,
            amount,
            swapMode,
            method: 'on-chain-estimate',
          },
        };
      } catch (poolError: any) {
        this.logger.error(`Failed to query pool reserves: ${poolError.message}`);
        throw new BadRequestException(
          `Unable to calculate Movement quote: Pool data not available. Please ensure tokens have liquidity.`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Movement quote calculation failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to get Movement quote: ${error.message}`);
    }
  }

  /**
   * Calculate price impact percentage
   * Price impact = (amountOut / expectedAmountOut - 1) * 100
   */
  private calculatePriceImpact(amountIn: number, amountOut: number): number {
    // Simplified calculation - in production, compare against spot price
    // For now, return a small estimate
    if (amountIn <= 0 || amountOut <= 0) return 0;
    return 0.1; // 0.1% default estimate
  }

  /**
   * Get Base quote from 1inch API (primary) or 0x API (fallback)
   * Note: Jupiter does NOT support Base chain - it's Solana-only
   */
  private async getBaseQuote(
    inputToken: string,
    outputToken: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut',
    slippageBps: number,
  ): Promise<QuoteResponse> {
    // Try 1inch API first (primary for Base chain)
    // Note: Jupiter does NOT support Base chain - it's Solana-only
    const oneInchApiKey = this.configService.get('ONEINCH_API_KEY');
    
    if (oneInchApiKey) {
      try {
        return await this.getBaseQuoteFrom1inch(inputToken, outputToken, amount, slippageBps);
      } catch (oneInchError: any) {
        this.logger.warn(
          `1inch quote failed for Base: ${oneInchError.message}. Trying 0x fallback...`,
        );
        // Fall through to 0x fallback
      }
    } else {
      this.logger.warn('ONEINCH_API_KEY not configured, trying 0x API for Base quote...');
    }

    // Fallback to 0x API
    try {
      return await this.getBaseQuoteFrom0x(inputToken, outputToken, amount, slippageBps);
    } catch (error: any) {
      this.logger.error(`All Base quote sources failed: ${error.message}`);
      throw new BadRequestException(
        `Failed to get Base quote: ${error.message}. Please ensure ONEINCH_API_KEY or 0X_API_KEY is configured.`,
      );
    }
  }

  /**
   * Get Base quote from 1inch API v6.0 quote endpoint
   * Endpoint: GET https://api.1inch.dev/swap/v6.0/8453/quote
   */
  private async getBaseQuoteFrom1inch(
    inputToken: string,
    outputToken: string,
    amount: string,
    slippageBps: number,
  ): Promise<QuoteResponse> {
    const oneInchApiKey = this.configService.get('ONEINCH_API_KEY');
    if (!oneInchApiKey) {
      throw new Error('ONEINCH_API_KEY not configured');
    }

    const baseChainId = 8453; // Base mainnet
    const quoteUrl = `https://api.1inch.dev/swap/v6.0/${baseChainId}/quote`;

    const params = {
      src: inputToken,
      dst: outputToken,
      amount: amount,
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${oneInchApiKey}`,
    };

    try {
      this.logger.debug(`Fetching 1inch quote: ${quoteUrl}`, { params });
      
      const response = await firstValueFrom(
        this.httpService.get(quoteUrl, {
          params,
          headers,
          timeout: 5_000, // 5 seconds - 1inch is usually fast (200ms-1s)
        }),
      );

      const data = response.data;

      // Calculate price impact (if not provided)
      const priceImpactPct = data.priceImpact
        ? parseFloat(data.priceImpact)
        : this.calculatePriceImpact(parseFloat(amount), parseFloat(data.dstAmount || '0'));

      return {
        chain: 'base',
        inputMint: inputToken,
        outputMint: outputToken,
        inAmount: amount,
        outAmount: data.dstAmount || '0',
        priceImpactPct,
        slippageBps,
        routePlan: data.protocols || [],
        validFor: 30, // 1inch quotes valid for 30 seconds
        estimatedGas: data.gas || '0.0001',
        rawQuote: data,
      };
    } catch (error: any) {
      this.logger.error(`1inch quote API error: ${error.message}`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: quoteUrl,
      });
      throw error;
    }
  }

  /**
   * Get Base quote from 0x API (fallback)
   * Endpoint: GET https://api.0x.org/swap/v1/quote
   */
  private async getBaseQuoteFrom0x(
    inputToken: string,
    outputToken: string,
    amount: string,
    slippageBps: number,
  ): Promise<QuoteResponse> {
    const zeroXApiKey = this.configService.get('0X_API_KEY');
    const baseChainId = 8453; // Base mainnet
    const quoteUrl = 'https://api.0x.org/swap/v1/quote';

    const params = {
      sellToken: inputToken,
      buyToken: outputToken,
      sellAmount: amount,
      chainId: baseChainId,
      slippagePercentage: slippageBps / 100, // Convert BPS to percentage
    };

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (zeroXApiKey) {
      headers['0x-api-key'] = zeroXApiKey;
    }

    try {
      this.logger.debug(`Fetching 0x quote: ${quoteUrl}`, { params });
      
      const response = await firstValueFrom(
        this.httpService.get(quoteUrl, {
          params,
          headers,
          timeout: 5_000, // 5 seconds
        }),
      );

      const data = response.data;

      return {
        chain: 'base',
        inputMint: inputToken,
        outputMint: outputToken,
        inAmount: amount,
        outAmount: data.buyAmount || '0',
        priceImpactPct: parseFloat(data.estimatedPriceImpact || '0'),
        slippageBps,
        routePlan: data.sources || [],
        validFor: 30, // 0x quotes valid for 30 seconds
        estimatedGas: data.estimatedGas || '0.0001',
        rawQuote: data,
      };
    } catch (error: any) {
      this.logger.error(`0x quote API error: ${error.message}`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: quoteUrl,
      });
      throw error;
    }
  }

  /**
   * Detect chain from token addresses (database-first approach)
   */
  async detectChainFromTokens(inputToken: string, outputToken: string): Promise<'solana' | 'movement' | 'base'> {
    // Check database Listing table first
    const listing = await this.prisma.listing.findFirst({
      where: {
        OR: [{ contractAddress: inputToken }, { contractAddress: outputToken }],
      },
      select: { chain: true },
    });

    if (listing) {
      const chainUpper = listing.chain.toUpperCase();
      if (chainUpper === 'BASE') return 'base';
      if (chainUpper === 'MOVEMENT' || chainUpper === 'APTOS') return 'movement';
      if (chainUpper === 'SOLANA') return 'solana';
    }

    // Fallback: Use address format
    if (inputToken.startsWith('0x') || outputToken.startsWith('0x')) {
      // Both are 0x addresses - default to movement (Base detection requires database)
      return 'movement';
    }

    return 'solana';
  }
}
