import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const identity = req.user?.userId ? `user:${req.user.userId}` : `ip:${forwarded || req.ip || 'unknown'}`;
    const route = `${req.method || 'REQUEST'}:${req.route?.path || req.path || 'unknown'}`;
    const windowSeconds = Math.max(1, Number(this.config.get('SCAN_RATE_LIMIT_WINDOW_SECONDS', 60)));
    const maxRequests = Math.max(1, Number(this.config.get('SCAN_RATE_LIMIT_MAX_REQUESTS', 10)));
    const key = `rate-limit:scan:${identity}:${route}`;

    let count = await this.cache.incrementWithExpiry(key, windowSeconds);
    if (count === null) {
      count = this.incrementFallback(key, windowSeconds);
    }

    if (count > maxRequests) {
      throw new HttpException(
        `Too many scan requests. Try again in ${windowSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private incrementFallback(key: string, windowSeconds: number): number {
    const now = Date.now();
    const existing = this.fallback.get(key);
    if (!existing || existing.resetAt <= now) {
      this.fallback.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      this.pruneFallback(now);
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  private pruneFallback(now: number): void {
    if (this.fallback.size < 1000) return;
    for (const [key, value] of this.fallback.entries()) {
      if (value.resetAt <= now) this.fallback.delete(key);
    }
    while (this.fallback.size > 5000) {
      const oldestKey = this.fallback.keys().next().value;
      if (!oldestKey) break;
      this.fallback.delete(oldestKey);
    }
  }
}
