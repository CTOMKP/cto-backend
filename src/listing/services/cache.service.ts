/*
  CacheService (Redis-backed)
  ---------------------------
  Uses REDIS_URL if provided; otherwise no-ops gracefully.
*/
import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType | null = null;
  private ready = false;

  constructor() {
    const url = process.env.REDIS_URL as string | undefined;
    if (!url) {
      this.logger.warn('REDIS_URL not set; Listing cache disabled.');
    } else {
      this.client = createClient({ url });
      this.client.on('error', (err) => {
        this.ready = false;
        this.logger.warn(`Redis error: ${err.message}`);
      });
      this.client.on('end', () => {
        this.ready = false;
        this.logger.debug('Redis connection ended');
      });
      this.client.on('ready', () => {
        this.ready = true;
        this.logger.log('Connected to Redis for Listing cache');
      });
      this.client.connect().catch((e) => this.logger.warn(`Redis connect failed: ${e.message}`));
    }
  }

  cacheKey(prefix: string, data: unknown): string {
    const payload = JSON.stringify(data ?? {});
    return `listing:${prefix}:${Buffer.from(payload).toString('base64')}`;
  }

  async get<T = any>(k: string): Promise<T | null> {
    if (!this.client || !this.ready) return null;
    try {
      const raw = await this.client.get(k);
      if (!raw) return null;
      const text = typeof raw === 'string' ? raw : String(raw);
      return JSON.parse(text) as T;
    } catch (e: any) {
      this.logger.debug(`cache get fail: ${e.message}`);
      return null;
    }
  }

  async set(k: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (!this.client || !this.ready) return;
    try {
      await this.client.setEx(k, ttlSeconds, JSON.stringify(value));
    } catch (e: any) {
      this.logger.debug(`cache set fail: ${e.message}`);
    }
  }

  async incrementWithExpiry(k: string, ttlSeconds: number): Promise<number | null> {
    if (!this.client || !this.ready) return null;
    try {
      const result = await this.client.eval(
        `local current = redis.call('INCR', KEYS[1])
         if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return current`,
        { keys: [k], arguments: [String(ttlSeconds)] },
      );
      return Number(result);
    } catch (e: any) {
      this.logger.debug(`cache increment fail: ${e.message}`);
      return null;
    }
  }

  async invalidateMatching(patterns: string[]): Promise<void> {
    if (!this.client || !this.ready) return;
    for (const p of patterns) {
      try {
        for await (const key of this.client.scanIterator({ MATCH: p, COUNT: 100 })) {
          await this.client.del(String(key));
        }
      } catch (e: any) {
        this.logger.debug(`cache invalidate fail: ${e.message}`);
      }
    }
  }
}
