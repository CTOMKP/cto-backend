import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisService } from '../image/redis.service';
import { TradeCacheService } from '../trades/trade-cache.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly redisService: RedisService,
    private readonly tradeCacheService: TradeCacheService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary: 'Application health check',
    description: 'Check if the CTO Vetting API is operational'
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'OK' },
        timestamp: { type: 'string', format: 'date-time' },
        uptime: { type: 'number', description: 'Application uptime in seconds' },
        environment: { type: 'string', example: 'development' },
        version: { type: 'string', example: '1.0.0' },
        redis: { 
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            url: { type: 'string', nullable: true }
          }
        }
      }
    }
  })
  async healthCheck() {
    const redisStatus = await this.redisService.isRedisAvailable();
    const redisUrl = process.env.REDIS_URL ? 'configured' : null;

    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      redis: {
        connected: redisStatus,
        url: redisUrl
      }
    };
  }

  @Get('health/redis')
  @ApiOperation({
    summary: 'Redis cache health',
    description: 'Check Redis connectivity and trade cache stats'
  })
  @ApiResponse({
    status: 200,
    description: 'Redis cache health info',
    schema: {
      type: 'object',
      properties: {
        redis: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            url: { type: 'string', nullable: true },
          },
        },
        tradeCache: {
          type: 'object',
          properties: {
            hits: { type: 'number' },
            misses: { type: 'number' },
            staleHits: { type: 'number' },
            memorySize: { type: 'number' },
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  async redisHealth() {
    const redisStatus = await this.redisService.isRedisAvailable();
    const redisUrl = process.env.REDIS_URL ? 'configured' : null;

    return {
      redis: {
        connected: redisStatus,
        url: redisUrl,
      },
      tradeCache: this.tradeCacheService.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}

