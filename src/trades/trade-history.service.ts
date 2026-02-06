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
    const apiKey =
      this.configService.get('BIRDEYE_API_KEY') ||
      '725a2e88183e417f99ab52b92e2bf6f5';

    if (!apiKey) {
      this.logger.warn('BIRDEYE_API_KEY missing; returning empty trades.');
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
      this.logger.warn(
        `Birdeye trades fetch failed for ${mintAddress}: ${error.message}`,
      );
    }

    await this.getHeliusTransactions(mintAddress, limit);
    return [];
  }

  private async getHeliusTransactions(
    address: string,
    limit: number,
  ): Promise<void> {
    const apiKey =
      this.configService.get('HELIUS_API_KEY') ||
      '1485e891-c87d-40e1-8850-a578511c4b92';

    if (!apiKey) return;

    try {
      await axios.get(
        `https://api.helius.xyz/v0/addresses/${address}/transactions`,
        {
          params: { 'api-key': apiKey, limit },
          timeout: 10_000,
        },
      );
    } catch (error: any) {
      this.logger.debug(
        `Helius tx fetch failed for ${address}: ${error.message}`,
      );
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
