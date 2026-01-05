import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export type TradeEventType = 'buy' | 'sell';

export interface TradeEvent {
  type: TradeEventType;
  swapper: string;
  amountMOVE: number;
  amountToken: number;
  priceUSD?: number | null;
  timestamp: string | number | Date;
  transactionHash: string;
}

interface CacheEntry {
  data: TradeEvent[];
  expiresAt: number;
}

@Injectable()
export class SentioService {
  private readonly logger = new Logger(SentioService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60 * 1000;

  constructor(private readonly http: HttpService) {}

  async getTokenTrades(tokenAddress: string, limit = 50): Promise<TradeEvent[]> {
    const apiKey = process.env.SENTIO_API_KEY;
    if (!apiKey) {
      this.logger.warn('SENTIO_API_KEY is not set; returning empty trades.');
      return [];
    }

    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const cacheKey = `${tokenAddress}:${safeLimit}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const baseUrl =
      process.env.SENTIO_API_URL || 'https://api.sentio.xyz/v1/trades';

    try {
      const response = await firstValueFrom(
        this.http.get(baseUrl, {
          params: { tokenAddress, limit: safeLimit },
          headers: {
            // Sentio commonly accepts either Bearer or x-api-key; using both for compatibility.
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
          timeout: 10_000,
        }),
      );

      const raw = this.normalizeResponse(response.data);
      const trades = raw.map((event) => this.toTradeEvent(event));

      this.cache.set(cacheKey, { data: trades, expiresAt: now + this.ttlMs });
      return trades;
    } catch (error) {
      this.logger.warn(
        `Sentio request failed for ${tokenAddress}: ${error?.message || error}`,
      );
      return [];
    }
  }

  private normalizeResponse(data: any): any[] {
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.events)) return data.events;
    if (Array.isArray(data)) return data;
    return [];
  }

  private toTradeEvent(event: any): TradeEvent {
    const rawType = (event?.side || event?.type || '').toString().toLowerCase();
    const type: TradeEventType = rawType === 'sell' ? 'sell' : 'buy';

    const amountMOVE = Number(
      event?.amountMove ?? event?.amountIn ?? event?.moveAmount ?? 0,
    );
    const amountToken = Number(
      event?.amountToken ??
        event?.amountOut ??
        event?.tokenAmount ??
        event?.amount ?? // generic fallback
        0,
    );

    const priceUSD =
      event?.priceUsd ?? event?.priceUSD ?? event?.usdPrice ?? null;

    return {
      type,
      swapper:
        event?.swapper ||
        event?.user ||
        event?.sender ||
        event?.account ||
        '',
      amountMOVE,
      amountToken,
      priceUSD,
      timestamp: event?.timestamp || event?.blockTime || event?.time || '',
      transactionHash:
        event?.txHash ||
        event?.transactionHash ||
        event?.hash ||
        event?.tx ||
        '',
    };
  }
}
