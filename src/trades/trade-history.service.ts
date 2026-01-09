import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(private readonly configService: ConfigService) {}

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
}
