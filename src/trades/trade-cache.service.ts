/*
  TradeCacheService (Redis-backed with in-memory L1)
  --------------------------------------------------
  Stores recent trade lists to reduce upstream load (free APIs / public indexers).
  Supports stale-if-error by keeping data longer than the "fresh" TTL.
*/
import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import type { UnifiedTrade } from './trade-history.service';

type CacheState = 'fresh' | 'stale';

interface TradeCachePayload {
  data: UnifiedTrade[];
  fetchedAt: number;
  expiresAt: number;
}

interface CacheGetResult {
  data: UnifiedTrade[];
  state: CacheState;
}

@Injectable()
export class TradeCacheService {
  private readonly logger = new Logger(TradeCacheService.name);
  private client: RedisClientType | null = null;
  private ready = false;

  // Fast local L1 cache to reduce Redis hops
  private readonly memory = new Map<string, { data: UnifiedTrade[]; expiresAt: number }>();

  private readonly defaultTtlSeconds = Number(process.env.TRADES_CACHE_TTL_SECONDS || 15);
  private readonly staleTtlSeconds = Number(process.env.TRADES_CACHE_STALE_TTL_SECONDS || 300);
  private hits = 0;
  private misses = 0;
  private staleHits = 0;

  constructor() {
    const url = process.env.REDIS_URL as string | undefined;
    if (!url) {
      this.logger.warn('REDIS_URL not set; Trade cache will use in-memory only.');
      return;
    }

    this.client = createClient({ url });
    this.client.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis error (trade cache): ${err.message}`);
    });
    this.client.on('end', () => {
      this.ready = false;
      this.logger.debug('Redis connection ended (trade cache)');
    });
    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('Connected to Redis for Trade cache');
    });
    this.client.connect().catch((e) => this.logger.warn(`Redis connect failed (trade cache): ${e.message}`));
  }

  buildKey(chain: string, address: string, limit: number): string {
    const safeAddress = address?.startsWith('0x') ? address.toLowerCase() : address;
    return `trades:${chain}:${safeAddress}:${limit}`;
  }

  async get(key: string): Promise<CacheGetResult | null> {
    const now = Date.now();

    const mem = this.memory.get(key);
    if (mem && mem.expiresAt > now) {
      this.hits += 1;
      return { data: mem.data, state: 'fresh' };
    }

    if (!this.client || !this.ready) return null;

    try {
      const raw = await this.client.get(key);
      if (!raw) {
        this.misses += 1;
        return null;
      }

      const payload = JSON.parse(raw) as TradeCachePayload;
      if (!payload || !Array.isArray(payload.data)) {
        this.misses += 1;
        return null;
      }

      const state: CacheState = payload.expiresAt > now ? 'fresh' : 'stale';
      if (state === 'fresh') this.hits += 1;
      if (state === 'stale') this.staleHits += 1;

      if (state === 'fresh') {
        this.memory.set(key, { data: payload.data, expiresAt: payload.expiresAt });
      }

      return { data: payload.data, state };
    } catch (e: any) {
      this.misses += 1;
      this.logger.debug(`trade cache get fail: ${e.message}`);
      return null;
    }
  }

  async set(
    key: string,
    data: UnifiedTrade[],
    ttlSeconds: number = this.defaultTtlSeconds,
  ): Promise<void> {
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    this.memory.set(key, { data, expiresAt });

    if (!this.client || !this.ready) return;

    const payload: TradeCachePayload = {
      data,
      fetchedAt: now,
      expiresAt,
    };

    try {
      // Keep data longer than "fresh" ttl to allow stale-if-error fallback
      await this.client.setEx(
        key,
        Math.max(this.staleTtlSeconds, ttlSeconds),
        JSON.stringify(payload),
      );
    } catch (e: any) {
      this.logger.debug(`trade cache set fail: ${e.message}`);
    }
  }

  getStats() {
    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      memorySize: this.memory.size,
    };
  }
}
