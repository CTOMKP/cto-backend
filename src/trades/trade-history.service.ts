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

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getTrades(address: string, limit = 50): Promise<UnifiedTrade[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `${address}:${safeLimit}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const chain = this.detectChain(address);
    const trades =
      chain === 'movement'
        ? await this.getMovementTrades(address, safeLimit)
        : await this.getSolanaTrades(address, safeLimit);

    this.cache.set(cacheKey, { data: trades, expiresAt: now + this.ttlMs });
    return trades;
  }

  private detectChain(address: string): 'movement' | 'solana' {
    return address?.startsWith('0x') ? 'movement' : 'solana';
  }

  private async getSolanaTrades(
    mintAddress: string,
    limit: number,
  ): Promise<UnifiedTrade[]> {
    // Directive 1: Use Helius Enhanced Transactions as PRIMARY source
    // Helius parses raw Solana transactions into "Swap" readable format
    const heliusTrades = await this.getHeliusEnhancedTrades(mintAddress, limit);
    if (heliusTrades.length > 0) {
      this.logger.log(
        `✅ Found ${heliusTrades.length} trades from Helius for ${mintAddress}`,
      );
      return heliusTrades;
    }

    // Fallback: Use Birdeye if Helius returns no data
    this.logger.log(
      `Helius returned no trades, trying Birdeye fallback for ${mintAddress}`,
    );
    return await this.getBirdeyeTrades(mintAddress, limit);
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
        return [];
      }

      const trades: UnifiedTrade[] = [];

      for (const tx of transactions) {
        // Extract swap events from transaction
        const swapEvents = this.extractSwapEventsFromHeliusTx(tx, mintAddress);
        trades.push(...swapEvents);

        if (trades.length >= limit) break;
      }

      return trades.slice(0, limit);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      this.logger.debug(
        `Helius Enhanced Transactions failed for ${mintAddress}: ${errorMessage}`,
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

    // PRIMARY CHECK: Look for type === "SWAP" (Helius already identifies swaps)
    if (tx.type !== 'SWAP') {
      return trades; // Not a swap transaction
    }

    // Extract swap data
    const tokenTransfers = tx.tokenTransfers || [];
    const nativeTransfers = tx.nativeTransfers || [];

    // Find transfers involving our token
    const relevantTransfers = tokenTransfers.filter(
      (transfer: any) => transfer.mint === mintAddress,
    );

    if (relevantTransfers.length === 0) {
      return trades; // No transfers for this token in this swap
    }

    // Check if this swap has multiple tokens (indicates a real swap, not just a transfer)
    const hasMultipleTokens =
      tokenTransfers.length > 1 &&
      new Set(tokenTransfers.map((t: any) => t.mint)).size > 1;
    const hasNativeTransfer = nativeTransfers.length > 0;

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
  ): Promise<UnifiedTrade[]> {
    const apiKey =
      this.configService.get('BIRDEYE_API_KEY') ||
      '725a2e88183e417f99ab52b92e2bf6f5';

    if (!apiKey) {
      this.logger.debug('BIRDEYE_API_KEY missing; skipping Birdeye trades.');
      return [];
    }

    try {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/txs/token',
        {
          params: {
            address: mintAddress,
            offset: 0,
            limit,
          },
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': 'solana',
          },
          timeout: 10_000,
        },
      );

      const items =
        response.data?.data?.items ||
        response.data?.data ||
        response.data?.items ||
        [];

      if (!Array.isArray(items)) return [];

      return items.map((item: any) => {
        const rawType =
          (item?.side || item?.type || '').toString().toLowerCase();
        const type: UnifiedTradeType = rawType === 'sell' ? 'SELL' : 'BUY';

        const amount = Number(
          item?.baseAmount ??
            item?.amount ??
            item?.amountToken ??
            item?.size ??
            0,
        );
        const price = Number(item?.price ?? item?.priceUsd ?? 0);
        const totalValue = Number(item?.value ?? item?.total ?? 0) ||
          amount * price;

        return {
          txHash:
            item?.txHash ||
            item?.tx_hash ||
            item?.signature ||
            '',
          timestamp: item?.blockTime || item?.time || item?.timestamp || '',
          type,
          price,
          amount,
          totalValue,
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
      const response = await axios.post(
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

      const rows =
        response.data?.data?.rows ||
        response.data?.data ||
        response.data?.rows ||
        [];

      if (!Array.isArray(rows)) return [];

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
      this.logger.warn(
        `Sentio SQL fetch failed for ${tokenAddress} (${status || 'n/a'}): ${
          body?.message || error?.message || error
        }`,
      );
      return [];
    }
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
