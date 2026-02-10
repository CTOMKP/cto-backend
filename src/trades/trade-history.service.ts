import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

export type UnifiedTradeType = 'BUY' | 'SELL';

export interface UnifiedTrade {
  txHash: string;
  timestamp: string | number | Date;
  type: UnifiedTradeType;
  price: number;
  amount: number;
  totalValue: number;
  makerAddress: string;
}

interface CacheEntry {
  data: UnifiedTrade[];
  expiresAt: number;
}

@Injectable()
export class TradeHistoryService {
  private readonly logger = new Logger(TradeHistoryService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 8_000;
  private readonly minTradeUsd = 0.5;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getTrades(address: string, limit = 50, chainHint?: string, noCache = false): Promise<UnifiedTrade[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const normalizedChain = this.normalizeChain(chainHint);
    const cacheKey = `${address}:${safeLimit}:${normalizedChain || 'auto'}`;
    const now = Date.now();
    if (!noCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }
    }

    const chain = normalizedChain || await this.detectChain(address);
    const priceHint = await this.getListingPriceUsd(address);
    let trades: UnifiedTrade[] = [];
    
    if (chain === 'base' || chain === 'ethereum' || chain === 'bsc') {
      trades = await this.getEvmTrades(address, safeLimit, chain, noCache);
    } else if (chain === 'movement') {
      trades = await this.getMovementTrades(address, safeLimit);
    } else if (chain === 'sui') {
      trades = await this.getSuiTrades(address, safeLimit, noCache);
    } else {
      trades = await this.getSolanaTrades(address, safeLimit, noCache);
    }

    const normalizedTrades = this.normalizeTrades(trades, priceHint);
    this.cache.set(cacheKey, { data: normalizedTrades, expiresAt: now + this.ttlMs });
    return normalizedTrades;
  }

  /**
   * Detect chain by checking database Listing first, then fallback to address format
   */
  private async detectChain(address: string): Promise<'movement' | 'solana' | 'base' | 'ethereum' | 'bsc' | 'sui'> {
    try {
      // Check database for the token's chain
      const listing = await this.prisma.listing.findFirst({
        where: {
          contractAddress: {
            equals: address,
            mode: 'insensitive',
          },
        },
        select: { chain: true },
      });

      if (listing) {
        const chainUpper = listing.chain.toUpperCase();
        if (chainUpper === 'BASE') return 'base';
        if (chainUpper === 'ETH' || chainUpper === 'ETHEREUM') return 'ethereum';
        if (chainUpper === 'BSC' || chainUpper === 'BNB') return 'bsc';
        if (chainUpper === 'SUI') return 'sui';
        if (chainUpper === 'MOVEMENT' || chainUpper === 'APTOS') {
          return 'movement';
        }
        if (chainUpper === 'SOLANA') {
          return 'solana';
        }
      }
    } catch (error: any) {
      this.logger.debug(
        `Failed to check database for chain detection: ${error.message}`,
      );
    }

    // Fallback: Use address format detection
    // Movement type tags include "::" (e.g., 0x1::aptos_coin::AptosCoin)
    if (address?.includes('::')) return 'movement';
    // EVM tokens use 0x addresses (Base/BSC/ETH). Default to base for now.
    if (address?.startsWith('0x')) return 'base';
    return 'solana';
  }

  private normalizeChain(chain?: string): 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc' | 'sui' | undefined {
    if (!chain) return undefined;
    const raw = chain.toLowerCase();
    if (raw === 'eth') return 'ethereum';
    if (raw === 'bnb') return 'bsc';
    if (raw === 'aptos') return 'movement';
    return raw as any;
  }

  private async getListingPriceUsd(tokenAddress: string): Promise<number> {
    try {
      const listing = await this.prisma.listing.findFirst({
        where: {
          contractAddress: {
            equals: tokenAddress,
            mode: 'insensitive',
          },
        },
        select: { priceUsd: true },
      });
      return Number(listing?.priceUsd) || 0;
    } catch (error: any) {
      this.logger.debug(`Failed to load listing price: ${error.message}`);
      return 0;
    }
  }

  private normalizeTrades(trades: UnifiedTrade[], priceHintUsd: number): UnifiedTrade[] {
    const groups = new Map<string, UnifiedTrade[]>();
    for (const trade of trades || []) {
      const txHash = trade?.txHash || '';
      if (!txHash) continue;
      const bucket = groups.get(txHash) || [];
      bucket.push(trade);
      groups.set(txHash, bucket);
    }

    const aggregated: UnifiedTrade[] = [];
    for (const [txHash, bucket] of groups) {
      const amountSum = bucket.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const totalSum = bucket.reduce((sum, t) => sum + (Number(t.totalValue) || 0), 0);
      let price = bucket.find((t) => Number(t.price) > 0)?.price || 0;
      const timestamp = bucket.find((t) => t.timestamp)?.timestamp || '';
      const makerAddress = bucket.find((t) => t.makerAddress)?.makerAddress || '';

      if (!price && totalSum > 0 && amountSum > 0) {
        price = totalSum / amountSum;
      }

      if ((!price || price <= 0) && priceHintUsd > 0 && amountSum > 0) {
        price = priceHintUsd;
      }

      let totalValue = totalSum > 0 ? totalSum : price > 0 && amountSum > 0 ? price * amountSum : 0;
      if ((!totalValue || totalValue <= 0) && priceHintUsd > 0 && amountSum > 0) {
        totalValue = priceHintUsd * amountSum;
      }

      const buyTotal = bucket
        .filter((t) => t.type === 'BUY')
        .reduce((sum, t) => sum + (Number(t.totalValue) || 0), 0);
      const sellTotal = bucket
        .filter((t) => t.type === 'SELL')
        .reduce((sum, t) => sum + (Number(t.totalValue) || 0), 0);
      const type: UnifiedTradeType =
        buyTotal === sellTotal
          ? bucket[0].type
          : buyTotal > sellTotal
            ? 'BUY'
            : 'SELL';

      // Hide dust or empty trades
      if (totalValue > 0 && totalValue < this.minTradeUsd) {
        continue;
      }
      if (amountSum <= 0 || totalValue <= 0 || price <= 0) {
        continue;
      }

      aggregated.push({
        txHash,
        timestamp,
        type,
        price: price || 0,
        amount: amountSum || 0,
        totalValue: totalValue || 0,
        makerAddress,
      });
    }

    return aggregated.sort((a, b) => {
      const tA = new Date(a.timestamp as any).getTime() || 0;
      const tB = new Date(b.timestamp as any).getTime() || 0;
      return tB - tA;
    });
  }

  private resolveBirdeyeTrade(item: any): {
    type: UnifiedTradeType;
    amount: number;
    price: number;
    totalValue: number;
  } {
    const rawSide = (item?.side || item?.type || '').toString().toLowerCase();
    let type: UnifiedTradeType | null =
      rawSide === 'sell' ? 'SELL' : rawSide === 'buy' ? 'BUY' : null;

    const amountRaw = Number(
      item?.baseAmount ??
        item?.amount ??
        item?.amountToken ??
        item?.size ??
        0,
    );
    const quoteRaw = Number(
      item?.quoteAmount ??
        item?.value ??
        item?.total ??
        item?.totalValue ??
        0,
    );

    const amount = Math.abs(amountRaw);
    const price = Number(item?.price ?? item?.priceUsd ?? item?.price_usd ?? 0);
    const totalValue =
      Number(item?.value ?? item?.total ?? item?.totalValue ?? item?.quoteAmount ?? 0) ||
      (amount > 0 && price > 0 ? amount * price : 0);

    if (!type) {
      if (amountRaw < 0 || quoteRaw < 0) {
        type = 'SELL';
      } else if (amountRaw > 0 || quoteRaw > 0) {
        type = 'BUY';
      } else {
        type = 'BUY';
      }
    }

    return {
      type,
      amount,
      price,
      totalValue,
    };
  }

  private async getSolanaTrades(
    mintAddress: string,
    limit: number,
    noCache: boolean,
  ): Promise<UnifiedTrade[]> {
    // Directive 1: Use Helius Enhanced Transactions as PRIMARY source
    // Helius parses raw Solana transactions into "Swap" readable format
    this.logger.debug(`Fetching Solana trades for ${mintAddress}`);
    
    const heliusTrades = await this.getHeliusEnhancedTrades(mintAddress, limit);
    if (heliusTrades.length > 0) {
      this.logger.log(
        `✅ Found ${heliusTrades.length} trades from Helius for ${mintAddress}`,
      );
      return heliusTrades;
    }

    // Fallback: Use Birdeye if Helius returns no data
    this.logger.log(
      `Helius returned no trades for ${mintAddress}, trying Birdeye fallback`,
    );
    const birdeyeTrades = await this.getBirdeyeTrades(mintAddress, limit, noCache);
    if (birdeyeTrades.length > 0) {
      this.logger.log(
        `✅ Found ${birdeyeTrades.length} trades from Birdeye for ${mintAddress}`,
      );
    } else {
      this.logger.warn(
        `⚠️ No trades found for ${mintAddress} from Helius or Birdeye`,
      );
    }
    return birdeyeTrades;
  }

  /**
   * Helius Enhanced Transactions - PRIMARY source for Solana trades
   * Parses raw Solana transactions and extracts swap events
   */
  private async getHeliusEnhancedTrades(
    mintAddress: string,
    limit: number,
  ): Promise<UnifiedTrade[]> {
    const apiKey =
      this.configService.get('HELIUS_API_KEY') ||
      '1485e891-c87d-40e1-8850-a578511c4b92';

    if (!apiKey) {
      this.logger.debug('HELIUS_API_KEY missing; skipping Helius trades.');
      return [];
    }

    try {
      // Helius Enhanced Transactions API - GET request
      // Endpoint: GET https://api.helius.xyz/v0/addresses/{address}/transactions?api-key={API_KEY}&limit={limit}
      this.logger.debug(`Fetching Helius trades for ${mintAddress} (limit: ${limit})`);
      
      const response = await axios.get(
        `https://api.helius.xyz/v0/addresses/${mintAddress}/transactions`,
        {
          params: {
            'api-key': apiKey,
            limit: Math.min(limit, 100), // Helius max is usually 100
          },
          timeout: 15_000,
        },
      );

      const transactions = response.data || [];
      if (!Array.isArray(transactions)) {
        this.logger.debug(`Helius returned non-array response for ${mintAddress}: ${typeof transactions}`);
        return [];
      }

      this.logger.debug(`Helius returned ${transactions.length} transactions for ${mintAddress}`);

      const trades: UnifiedTrade[] = [];

      for (const tx of transactions) {
        // Extract swap events from transaction
        const swapEvents = this.extractSwapEventsFromHeliusTx(tx, mintAddress);
        trades.push(...swapEvents);

        if (trades.length >= limit) break;
      }

      this.logger.debug(`Extracted ${trades.length} swap trades from ${transactions.length} transactions for ${mintAddress}`);
      return trades.slice(0, limit);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      const statusCode = error.response?.status;
      this.logger.warn(
        `Helius Enhanced Transactions failed for ${mintAddress} (${statusCode || 'n/a'}): ${errorMessage}`,
      );
      return [];
    }
  }

  /**
   * Extract swap events from Helius Enhanced Transaction format
   * Based on actual Helius API response structure
   */
  private extractSwapEventsFromHeliusTx(
    tx: any,
    mintAddress: string,
  ): UnifiedTrade[] {
    const trades: UnifiedTrade[] = [];

    // Helius Enhanced Transactions response structure:
    // - tx.type: "SWAP" | "TRANSFER" | "INITIALIZE_ACCOUNT" | etc.
    // - tx.description: Human-readable description
    // - tx.tokenTransfers: array of token transfers with mint, rawTokenAmount, fromUserAccount, toUserAccount
    // - tx.nativeTransfers: array of SOL transfers
    // - tx.signature: transaction hash
    // - tx.timestamp: Unix timestamp
    // - tx.feePayer: address that paid fees (often the trader)

    // Extract swap data
    const tokenTransfers = tx.tokenTransfers || [];
    const nativeTransfers = tx.nativeTransfers || [];

    // Find transfers involving our token
    const relevantTransfers = tokenTransfers.filter(
      (transfer: any) => transfer.mint === mintAddress,
    );

    if (relevantTransfers.length === 0) {
      return trades; // No transfers for this token
    }

    // Check if this is a swap transaction:
    // 1. Type is "SWAP" (Helius classification)
    // 2. OR has multiple different tokens (indicates a swap, not just a transfer)
    // 3. OR has both token transfers and native SOL transfers (swap pattern)
    const hasMultipleTokens =
      tokenTransfers.length > 1 &&
      new Set(tokenTransfers.map((t: any) => t.mint)).size > 1;
    const hasNativeTransfer = nativeTransfers.length > 0;
    const isSwapType = tx.type === 'SWAP';
    const looksLikeSwap = hasMultipleTokens || (hasNativeTransfer && tokenTransfers.length > 0);

    // Only process if it's a swap (either classified as SWAP or looks like a swap)
    if (!isSwapType && !looksLikeSwap) {
      return trades; // Not a swap transaction
    }

    // Process each relevant transfer
    for (const transfer of relevantTransfers) {
      // Extract token amount - Helius response structure:
      // transfer.rawTokenAmount = { tokenAmount: number, decimals: number }
      // OR transfer.tokenAmount = number (already normalized)
      let normalizedAmount = 0;
      let decimals = 6;

      if (transfer.rawTokenAmount) {
        // Use rawTokenAmount if available (more reliable)
        const rawAmount = transfer.rawTokenAmount.tokenAmount || 0;
        decimals = transfer.rawTokenAmount.decimals || 6;
        normalizedAmount = Math.abs(Number(rawAmount)) / Math.pow(10, decimals);
      } else if (transfer.tokenAmount) {
        // Fallback to tokenAmount (might already be normalized)
        normalizedAmount = Math.abs(Number(transfer.tokenAmount));
      }

      if (normalizedAmount <= 0) continue;

      // Determine buy/sell based on transfer direction
      // Positive rawAmount = receiving token = BUY
      // Negative rawAmount = sending token = SELL
      const rawAmount = transfer.rawTokenAmount?.tokenAmount || transfer.tokenAmount || 0;
      const isReceiving = Number(rawAmount) > 0;
      const type: UnifiedTradeType = isReceiving ? 'BUY' : 'SELL';

      // Find corresponding SOL transfer for price calculation
      let solAmount = 0;
      
      // Method 1: Check nativeTransfers for SOL
      if (hasNativeTransfer) {
        const traderAccount = tx.feePayer;
        const solTransfer = nativeTransfers.find(
          (nt: any) =>
            (nt.fromUserAccount === traderAccount || nt.toUserAccount === traderAccount) &&
            Math.abs(Number(nt.amount)) > 1000000, // Filter out small amounts (fees)
        );
        if (solTransfer) {
          solAmount = Math.abs(Number(solTransfer.amount)) / 1e9;
        }
      }

      // Method 2: Check tokenTransfers for wrapped SOL
      if (solAmount === 0 && hasMultipleTokens) {
        const solTransfer = tokenTransfers.find(
          (t: any) => t.mint === 'So11111111111111111111111111111111111111112',
        );
        if (solTransfer && solTransfer.rawTokenAmount) {
          const rawSolAmount = solTransfer.rawTokenAmount.tokenAmount || 0;
          const solDecimals = solTransfer.rawTokenAmount.decimals || 9;
          solAmount = Math.abs(Number(rawSolAmount)) / Math.pow(10, solDecimals);
        }
      }

      // Calculate price (SOL per token)
      const price = solAmount > 0 && normalizedAmount > 0
        ? solAmount / normalizedAmount
        : 0;

      trades.push({
        txHash: tx.signature || '',
        timestamp: tx.timestamp
          ? new Date(tx.timestamp * 1000).toISOString()
          : '',
        type,
        price,
        amount: normalizedAmount,
        totalValue: solAmount || (price > 0 ? normalizedAmount * price : 0),
        makerAddress: tx.feePayer || transfer.fromUserAccount || transfer.toUserAccount || '',
      });
    }

    return trades;
  }

  /**
   * Birdeye API - FALLBACK source for Solana trades
   */
  private async getBirdeyeTrades(
    mintAddress: string,
    limit: number,
    noCache: boolean,
  ): Promise<UnifiedTrade[]> {
    const apiKey =
      this.configService.get('BIRDEYE_API_KEY') ||
      '725a2e88183e417f99ab52b92e2bf6f5';

    if (!apiKey) {
      this.logger.debug('BIRDEYE_API_KEY missing; skipping Birdeye trades.');
      return [];
    }

    try {
      this.logger.debug(`Fetching Birdeye trades for ${mintAddress} (limit: ${limit})`);
      
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/txs',
        {
          params: {
            address: mintAddress,
            offset: 0,
            limit,
            ...(noCache ? { _ts: Date.now() } : {}),
          },
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': 'solana',
            ...(noCache
              ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
              : {}),
          },
          timeout: 10_000,
        },
      );

      // Check for error response
      if (response.data?.success === false) {
        this.logger.warn(
          `Birdeye API error for ${mintAddress}: ${response.data?.message || 'Unknown error'}`,
        );
        return [];
      }

      const items =
        response.data?.data?.items ||
        response.data?.data ||
        response.data?.items ||
        [];

      if (!Array.isArray(items)) {
        this.logger.debug(`Birdeye returned non-array response for ${mintAddress}: ${typeof items}`);
        return [];
      }

      this.logger.debug(`Birdeye returned ${items.length} trades for ${mintAddress}`);

      return items.map((item: any) => {
        const resolved = this.resolveBirdeyeTrade(item);

        return {
          txHash:
            item?.txHash ||
            item?.tx_hash ||
            item?.signature ||
            '',
          timestamp: item?.blockTime || item?.time || item?.timestamp || '',
          type: resolved.type,
          price: resolved.price,
          amount: resolved.amount,
          totalValue: resolved.totalValue,
          makerAddress:
            item?.maker ||
            item?.owner ||
            item?.sourceOwner ||
            '',
        };
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      const errorDetails = error.response?.data || {};

      this.logger.debug(
        `Birdeye trades fetch failed for ${mintAddress}: ${errorMessage}`,
      );

      if (error.response?.status) {
        this.logger.debug(
          `Birdeye API Error: Status ${error.response.status}, Data: ${JSON.stringify(errorDetails)}`,
        );
      }

      return [];
    }
  }

  // Removed: getHeliusTransactions - now using getHeliusEnhancedTrades instead

  /**
   * Normalize Movement token address
   * Extracts the address part from type tags like "0x123::MODULE::STRUCT"
   * Returns just the address part for matching
   */
  private normalizeMovementTokenAddress(tokenAddress: string): string {
    if (!tokenAddress) return tokenAddress;

    // If it's a type tag format (contains ::), extract the address part
    if (tokenAddress.includes('::')) {
      const parts = tokenAddress.split('::');
      return parts[0]; // Return the address part (before first ::)
    }

    // Otherwise return as-is
    return tokenAddress;
  }

  /**
   * Get Base chain trades using Birdeye Base endpoint
   * Endpoint: https://public-api.birdeye.so/defi/history_price?address=${address}&address_type=token&type=1m
   * Alternative: Use DexScreener for actual trades
   */
  private async getEvmTrades(
    tokenAddress: string,
    limit: number,
    chain: 'base' | 'ethereum' | 'bsc',
    noCache: boolean,
  ): Promise<UnifiedTrade[]> {
    // Try Birdeye Base endpoint first
    const birdeyeTrades = await this.getBirdeyeEvmTrades(tokenAddress, limit, chain, noCache);
    if (birdeyeTrades.length > 0) {
      this.logger.log(
        `✅ Found ${birdeyeTrades.length} Base trades from Birdeye for ${tokenAddress}`,
      );
      return birdeyeTrades;
    }

    // Fallback to DexScreener
    this.logger.log(
      `Birdeye returned no ${chain} trades, trying DexScreener fallback for ${tokenAddress}`,
    );
    return await this.getDexScreenerEvmTrades(tokenAddress, limit, chain);
  }

  /**
   * Birdeye Base API - PRIMARY source for Base trades
   * Uses the same txs/token endpoint as Solana but with x-chain: base header
   * Alternative endpoint mentioned: https://public-api.birdeye.so/defi/history_price?address=${address}&address_type=token&type=1m
   * (Note: history_price returns price history/candles, not individual trades)
   */
  private async getBirdeyeEvmTrades(
    tokenAddress: string,
    limit: number,
    chain: 'base' | 'ethereum' | 'bsc',
    noCache: boolean,
  ): Promise<UnifiedTrade[]> {
    const apiKey =
      this.configService.get('BIRDEYE_API_KEY') ||
      '725a2e88183e417f99ab52b92e2bf6f5';

    if (!apiKey) {
      this.logger.debug('BIRDEYE_API_KEY missing; skipping Birdeye EVM trades.');
      return [];
    }

    try {
      // Use the txs/token endpoint for Base (same as Solana but with x-chain: base)
      const tradesResponse = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/txs',
        {
          params: {
            address: tokenAddress,
            offset: 0,
            limit,
            ...(noCache ? { _ts: Date.now() } : {}),
          },
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': chain,
            ...(noCache
              ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
              : {}),
          },
          timeout: 10_000,
        },
      );

      const items =
        tradesResponse.data?.data?.items ||
        tradesResponse.data?.data ||
        tradesResponse.data?.items ||
        [];

      if (!Array.isArray(items)) return [];

      return items.map((item: any) => {
        const resolved = this.resolveBirdeyeTrade(item);

        return {
          txHash:
            item?.txHash ||
            item?.tx_hash ||
            item?.signature ||
            '',
          timestamp: item?.blockTime || item?.time || item?.timestamp || '',
          type: resolved.type,
          price: resolved.price,
          amount: resolved.amount,
          totalValue: resolved.totalValue,
          makerAddress:
            item?.maker ||
            item?.owner ||
            item?.sourceOwner ||
            '',
        };
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      const errorDetails = error.response?.data || {};
      
      this.logger.debug(
        `Birdeye ${chain} trades fetch failed for ${tokenAddress}: ${errorMessage}`,
      );

      if (error.response?.status) {
        this.logger.debug(
          `Birdeye ${chain} API Error: Status ${error.response.status}, Data: ${JSON.stringify(errorDetails)}`,
        );
      }

      return [];
    }
  }

  /**
   * DexScreener API - FALLBACK source for Base trades
   * Fetches pair data and extracts recent trades
   */
  private async getDexScreenerEvmTrades(
    tokenAddress: string,
    limit: number,
    chain: 'base' | 'ethereum' | 'bsc',
  ): Promise<UnifiedTrade[]> {
    try {
      // DexScreener API endpoint for token pairs
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        {
          timeout: 10_000,
        },
      );

      const pairs = response.data?.pairs || [];
      if (!Array.isArray(pairs) || pairs.length === 0) {
        this.logger.debug(
          `DexScreener: No pairs found for Base token ${tokenAddress}`,
        );
        return [];
      }

      // Find the most liquid pair (usually the first one or highest liquidity)
      const chainIdMatch =
        chain === 'base'
          ? (p: any) => p.chainId === 'base' || p.chainId === '8453'
          : chain === 'bsc'
            ? (p: any) => p.chainId === 'bsc' || p.chainId === '56'
            : (p: any) => p.chainId === 'ethereum' || p.chainId === '1';

      const basePair = pairs
        .filter(chainIdMatch)
        .sort((a: any, b: any) => {
          const liqA = Number(a.liquidity?.usd || 0);
          const liqB = Number(b.liquidity?.usd || 0);
          return liqB - liqA;
        })[0];

      if (!basePair) {
        this.logger.debug(
        `DexScreener: No ${chain} chain pair found for ${tokenAddress}`,
        );
        return [];
      }

      // DexScreener doesn't provide individual trade history in the free API
      // But we can use the pair's transaction count and recent activity
      // For actual trades, we'd need to use a different endpoint or service
      // For now, return empty array and log that we need a different approach
      this.logger.debug(
        `DexScreener: Found ${chain} pair ${basePair.pairAddress} for ${tokenAddress}, but individual trades not available in free API`,
      );

      // Note: DexScreener free API doesn't provide individual trade history
      // We would need to use their paid API or another service for actual trades
      return [];
    } catch (error: any) {
      this.logger.warn(
        `DexScreener ${chain} fallback failed for ${tokenAddress}: ${error.message}`,
      );
      return [];
    }
  }

  private async getDexScreenerTrades(
    mintAddress: string,
    limit: number,
  ): Promise<UnifiedTrade[]> {
    try {
      // DexScreener doesn't provide individual trades, but we can get pair data
      // For actual trades, we'd need to use a different source
      // This is a placeholder that returns empty for now
      this.logger.debug(
        `DexScreener doesn't provide individual trades for ${mintAddress}`,
      );
      return [];
    } catch (error: any) {
      this.logger.warn(
        `DexScreener fallback failed for ${mintAddress}: ${error.message}`,
      );
      return [];
    }
  }

  private async getMovementTrades(
    tokenAddress: string,
    limit: number,
  ): Promise<UnifiedTrade[]> {
    // First, try local DB (webhook-pushed trades)
    const dbTrades = await this.getMovementTradesFromDb(tokenAddress, limit);
    if (dbTrades.length > 0) {
      this.logger.debug(`✅ Found ${dbTrades.length} Movement trades from DB for ${tokenAddress}`);
      return dbTrades;
    }

    const apiKey = this.configService.get('SENTIO_API_KEY');
    if (!apiKey) {
      this.logger.warn('SENTIO_API_KEY missing; returning empty trades.');
      return [];
    }

    const project =
      this.configService.get('SENTIO_PROJECT') ||
      'ctomarketplace2025/cto-movement-tracker';
    const sqlUrl =
      this.configService.get('SENTIO_SQL_URL') ||
      `https://api.sentio.xyz/v1/projects/${project}/sql`;

    // Normalize token address: Extract address part from type tags like "0x123::MODULE::STRUCT"
    const normalizedToken = this.normalizeMovementTokenAddress(tokenAddress);
    this.logger.debug(
      `Querying Movement trades for token: ${tokenAddress} (normalized: ${normalizedToken})`,
    );

    // Try exact match first (works for both full type tags and address-only)
    // If that returns no results, we'll know the token format in DB is different
    const query = `
      select
        tx_hash as "txHash",
        block_time as "timestamp",
        maker_address as "makerAddress",
        price,
        case
          when lower(token_out) = lower(:token) then amount_out
          else amount_in
        end as "amount",
        total_value as "totalValue",
        token_in as "tokenIn",
        token_out as "tokenOut",
        case
          when lower(token_out) = lower(:token) then 'BUY'
          else 'SELL'
        end as "type"
      from movement_trades
      where lower(token_in) = lower(:token)
         or lower(token_out) = lower(:token)
      order by block_time desc
      limit :limit
    `;

    try {
      // First try with the original token address (full type tag)
      let response = await axios.post(
        sqlUrl,
        { query, params: { token: tokenAddress, limit } },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
          timeout: 10_000,
        },
      );

      let rows =
        response.data?.data?.rows ||
        response.data?.data ||
        response.data?.rows ||
        [];

      // If no results with full type tag, try with just the address part
      if (!Array.isArray(rows) || rows.length === 0) {
        if (normalizedToken !== tokenAddress) {
          this.logger.debug(
            `No trades found with full type tag, trying normalized address: ${normalizedToken}`,
          );
          response = await axios.post(
            sqlUrl,
            { query, params: { token: normalizedToken, limit } },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'x-api-key': apiKey,
              },
              timeout: 10_000,
            },
          );
          rows =
            response.data?.data?.rows ||
            response.data?.data ||
            response.data?.rows ||
            [];
        }
      }

      if (!Array.isArray(rows)) {
        this.logger.debug(
          `Sentio returned non-array response for ${tokenAddress}: ${typeof rows}`,
        );
        return [];
      }

      this.logger.debug(
        `Sentio returned ${rows.length} trades for ${tokenAddress}`,
      );

      return rows.map((row: any) => ({
        txHash: row.txHash || row.tx_hash || '',
        timestamp: row.timestamp || row.block_time || '',
        type: row.type === 'SELL' ? 'SELL' : 'BUY',
        price: Number(row.price ?? 0),
        amount: Number(row.amount ?? 0),
        totalValue: Number(row.totalValue ?? row.total_value ?? 0),
        makerAddress: row.makerAddress || row.maker_address || '',
      }));
    } catch (error: any) {
      const status = error?.response?.status;
      const body = error?.response?.data;
      
      // 404 means the token might not be indexed yet, which is okay
      if (status === 404) {
        this.logger.debug(
          `Token ${tokenAddress} not found in Sentio indexer (404). This may mean the token has no trades yet or isn't indexed.`,
        );
      } else {
      this.logger.warn(
        `Sentio SQL fetch failed for ${tokenAddress} (${status || 'n/a'}): ${
            body?.message || error?.message || 'Unknown error'
        }`,
      );
      }
      return [];
    }
  }

  private async getSuiTrades(
    tokenAddress: string,
    limit: number,
    noCache: boolean,
  ): Promise<UnifiedTrade[]> {
    const apiKey =
      this.configService.get('BIRDEYE_API_KEY') ||
      '725a2e88183e417f99ab52b92e2bf6f5';

    if (!apiKey) {
      this.logger.debug('BIRDEYE_API_KEY missing; skipping Birdeye Sui trades.');
      return [];
    }

    try {
      const response = await axios.get('https://public-api.birdeye.so/defi/v3/token/txs', {
        params: {
          address: tokenAddress,
          offset: 0,
          limit,
          ...(noCache ? { _ts: Date.now() } : {}),
        },
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': 'sui',
          ...(noCache
            ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
            : {}),
        },
        timeout: 10_000,
      });

      if (response.data?.success === false) {
        this.logger.warn(
          `Birdeye Sui API error for ${tokenAddress}: ${response.data?.message || 'Unknown error'}`,
        );
        return [];
      }

      const items =
        response.data?.data?.items ||
        response.data?.data ||
        response.data?.items ||
        [];

      if (!Array.isArray(items)) {
        return [];
      }

      return items.map((item: any) => {
        const resolved = this.resolveBirdeyeTrade(item);

        return {
          txHash:
            item?.txHash ||
            item?.tx_hash ||
            item?.signature ||
            '',
          timestamp: item?.blockTime || item?.time || item?.timestamp || '',
          type: resolved.type,
          price: resolved.price,
          amount: resolved.amount,
          totalValue: resolved.totalValue,
          makerAddress:
            item?.maker ||
            item?.owner ||
            item?.sourceOwner ||
            '',
        };
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      this.logger.debug(
        `Birdeye Sui trades fetch failed for ${tokenAddress}: ${errorMessage}`,
      );
      return [];
    }
  }

  /**
   * Movement trades from local DB (webhook push)
   */
  private async getMovementTradesFromDb(
    tokenAddress: string,
    limit: number,
  ): Promise<UnifiedTrade[]> {
    try {
      const trades = await this.prisma.userTrade.findMany({
          where: {
            chain: 'movement',
            OR: [
              { tokenInAddress: { equals: tokenAddress, mode: 'insensitive' } },
              { tokenOutAddress: { equals: tokenAddress, mode: 'insensitive' } },
            ],
          },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return trades.map((t) => ({
        txHash: t.txHash,
        timestamp: t.createdAt,
        type: t.type as UnifiedTradeType,
        price: Number(t.price ?? 0),
        amount: Number(t.amountOut ?? 0),
        totalValue: Number(t.amountIn ?? 0),
        makerAddress: t.walletId || '',
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch Movement trades from DB: ${error.message}`);
      return [];
    }
  }

  /**
   * Ingest Sentio webhook payload (Movement trades) into UserTrade table
   */
  async ingestSentioWebhook(payload: any): Promise<{ inserted: number; skipped: number }> {
    const events = this.normalizeSentioEvents(payload);
    if (events.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    const systemUserId = await this.getOrCreateSystemUserId();

    let inserted = 0;
    let skipped = 0;

    for (const ev of events) {
      const txHash = ev.txHash;
      if (!txHash) {
        skipped += 1;
        continue;
      }

      try {
        const traderAddress = (ev.traderAddress || '').toLowerCase();
        const wallet = traderAddress
          ? await this.prisma.wallet.findFirst({
              where: { address: traderAddress },
              select: { id: true, userId: true },
            })
          : null;

        const userId = wallet?.userId || systemUserId;

        const tokenInRaw = ev.tokenIn || '';
        const tokenOutRaw = ev.tokenOut || '';
        const tokenIn = tokenInRaw.toLowerCase();
        const tokenOut = tokenOutRaw.toLowerCase();
        const isBuy =
          tokenIn.toLowerCase().includes('aptos_coin') ||
          tokenIn.toLowerCase().includes('usdc');

        await this.prisma.userTrade.create({
          data: {
            userId,
            chain: 'movement',
            type: isBuy ? 'BUY' : 'SELL',
            tokenInAddress: tokenIn,
            tokenOutAddress: tokenOut,
            tokenInSymbol: this.extractSymbol(tokenInRaw),
            tokenOutSymbol: this.extractSymbol(tokenOutRaw),
            amountIn: String(ev.amountIn || '0'),
            amountOut: String(ev.amountOut || '0'),
            price: ev.price ? Number(ev.price) : null,
            slippageBps: ev.slippageBps || 50,
            priceImpact: ev.priceImpact ? Number(ev.priceImpact) : null,
            txHash,
            status: 'completed',
            walletId: wallet?.id,
            completedAt: ev.timestamp ? new Date(ev.timestamp) : new Date(),
          },
        });

        inserted += 1;
      } catch (error: any) {
        if (error.code === 'P2002') {
          skipped += 1;
          continue;
        }
        this.logger.warn(`Failed to ingest Sentio trade ${ev.txHash}: ${error.message}`);
        skipped += 1;
      }
    }

    return { inserted, skipped };
  }

  private normalizeSentioEvents(payload: any): Array<{
    txHash: string;
    timestamp?: string | number | Date;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string | number;
    amountOut?: string | number;
    price?: string | number;
    priceImpact?: string | number;
    slippageBps?: number;
    traderAddress?: string;
  }> {
    if (!payload) return [];

    const events =
      payload.events ||
      payload.data?.events ||
      payload.data ||
      payload.rows ||
      payload;

    const list = Array.isArray(events) ? events : [events];

    return list.map((e: any) => ({
      txHash: e.txHash || e.tx_hash || e.transaction_hash || e.transactionHash,
      timestamp: e.block_time || e.timestamp,
      tokenIn: e.token_in || e.tokenIn || e.input_token,
      tokenOut: e.token_out || e.tokenOut || e.output_token,
      amountIn: e.amount_in || e.amountIn || e.input_amount,
      amountOut: e.amount_out || e.amountOut || e.output_amount,
      price: e.price,
      priceImpact: e.priceImpact,
      slippageBps: e.slippageBps,
      traderAddress: e.trader_address || e.maker_address || e.sender,
    }));
  }

  private async getOrCreateSystemUserId(): Promise<number> {
    const email =
      this.configService.get('SENTIO_SYSTEM_USER_EMAIL') || 'sentio@system.local';

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing.id;

    const created = await this.prisma.user.create({
      data: {
        email,
        name: 'Sentio System',
        role: 'USER',
        provider: 'sentio',
      } as any,
    });
    return created.id;
  }

  /**
   * Sync Movement trades from Sentio to UserTrade table
   * This bridges external Sentio data with PostgreSQL for unified user view
   */
  async syncSentioTradesToUserTrade(
    userId: number,
    walletAddress: string,
    walletId?: string,
  ): Promise<number> {
    const apiKey = this.configService.get('SENTIO_API_KEY');
    if (!apiKey) {
      this.logger.warn('SENTIO_API_KEY missing; cannot sync trades.');
      return 0;
    }

    const project =
      this.configService.get('SENTIO_PROJECT') ||
      'ctomarketplace2025/cto-movement-tracker';
    const sqlUrl =
      this.configService.get('SENTIO_SQL_URL') ||
      `https://api.sentio.xyz/v1/projects/${project}/sql`;

    // Query Sentio for trades by this wallet address
    const query = `
      SELECT 
        transaction_hash as tx_hash,
        block_time,
        token_in,
        token_out,
        amount_in,
        amount_out,
        trader_address
      FROM movement_trades
      WHERE trader_address = :wallet_address
      ORDER BY block_time DESC
      LIMIT 100
    `;

    try {
      const response = await axios.post(
        sqlUrl,
        { query, params: { wallet_address: walletAddress } },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
          timeout: 10_000,
        },
      );

      const rows =
        response.data?.data?.rows ||
        response.data?.data ||
        response.data?.rows ||
        [];

      if (!Array.isArray(rows) || rows.length === 0) {
        return 0;
      }

      // Get existing txHashes to avoid duplicates
      const existingTxHashes = await this.prisma.userTrade.findMany({
        where: { userId, txHash: { in: rows.map((r: any) => r.tx_hash) } },
        select: { txHash: true },
      });
      const existingSet = new Set(existingTxHashes.map((t) => t.txHash));

      // Insert new trades
      let syncedCount = 0;
      for (const row of rows) {
        const txHash = row.tx_hash || row.transaction_hash;
        if (!txHash || existingSet.has(txHash)) {
          continue;
        }

        // Determine trade type: BUY if token_out is the target token, SELL otherwise
        // For Movement, if token_in is aptos_coin or USDC, it's a BUY
        const isBuy =
          row.token_in?.toLowerCase().includes('aptos_coin') ||
          row.token_in?.toLowerCase().includes('usdc');

        try {
          const tradeData: any = {
            userId,
            chain: 'movement',
            type: isBuy ? 'BUY' : 'SELL',
            tokenInAddress: row.token_in || '',
            tokenOutAddress: row.token_out || '',
            tokenInSymbol: this.extractSymbol(row.token_in),
            tokenOutSymbol: this.extractSymbol(row.token_out),
            amountIn: String(row.amount_in || '0'),
            amountOut: String(row.amount_out || '0'),
            slippageBps: 50, // Default slippage (0.5%) - can be updated later if needed
            txHash,
            status: 'completed',
            completedAt: row.block_time
              ? new Date(row.block_time)
              : new Date(),
          };

          // Only include walletId if provided
          if (walletId) {
            tradeData.walletId = walletId;
          }

          await this.prisma.userTrade.create({
            data: tradeData,
          });
          syncedCount++;
        } catch (error: any) {
          // Skip if duplicate (unique constraint on txHash)
          if (error.code !== 'P2002') {
            this.logger.warn(
              `Failed to sync trade ${txHash}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log(
        `Synced ${syncedCount} Movement trades for user ${userId}`,
      );
      return syncedCount;
    } catch (error: any) {
      this.logger.error(
        `Failed to sync Sentio trades for user ${userId}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Extract token symbol from Movement token address/type
   */
  private extractSymbol(tokenAddress: string): string | null {
    if (!tokenAddress) return null;
    // Extract symbol from type strings like "0x1::aptos_coin::AptosCoin"
    const parts = tokenAddress.split('::');
    if (parts.length >= 3) {
      return parts[2].replace('Coin', '').toUpperCase();
    }
    return null;
  }

  /**
   * Get user's trade history (unified query combining UserTrade + Listing)
   */
  async getUserTradeHistory(
    userId: number,
    limit: number = 50,
  ): Promise<any[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    // Use Prisma's query builder for the unified query
    const trades = await this.prisma.userTrade.findMany({
      where: { userId },
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      include: {
        wallet: {
          select: {
            address: true,
            blockchain: true,
          },
        },
      },
    });

    // Enrich with Listing data (token metadata)
    const enrichedTrades = await Promise.all(
      trades.map(async (trade) => {
        // Find the token listing (tokenOutAddress is the token being traded)
        const listing = await this.prisma.listing.findFirst({
          where: {
            contractAddress: trade.tokenOutAddress,
            chain: trade.chain.toUpperCase() as any, // Convert to Chain enum
          },
          select: {
            symbol: true,
            name: true,
          },
        });

        return {
          id: trade.id,
          txHash: trade.txHash,
          chain: trade.chain,
          type: trade.type,
          tokenInSymbol: trade.tokenInSymbol || listing?.symbol,
          tokenOutSymbol: trade.tokenOutSymbol || listing?.symbol,
          tokenInAddress: trade.tokenInAddress,
          tokenOutAddress: trade.tokenOutAddress,
          tokenName: listing?.name,
          amountIn: trade.amountIn,
          amountOut: trade.amountOut,
          price: trade.price,
          slippageBps: trade.slippageBps,
          priceImpact: trade.priceImpact,
          status: trade.status,
          walletAddress: trade.wallet?.address,
          createdAt: trade.createdAt,
          completedAt: trade.completedAt,
        };
      }),
    );

    return enrichedTrades;
  }
}
