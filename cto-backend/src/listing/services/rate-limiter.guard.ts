import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private lastCall = new Map<string, number>();
  private windowMs = 1000; // 1 req/sec per IP

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const last = this.lastCall.get(ip) || 0;
    if (now - last < this.windowMs) return false;
    this.lastCall.set(ip, now);
    return true;
  }
}