import { Module } from '@nestjs/common';
import { ListingController } from './listing.controller';
import { ListingService } from './listing.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ListingRepository } from './repository/listing.repository';
import { CacheService } from './services/cache.service';
import { RefreshWorker } from './workers/refresh.worker';
import { ScanModule } from '../scan/scan.module';
import { RateLimiterGuard } from './services/rate-limiter.guard';
import { MetricsService } from './services/metrics.service';
import { ListingGateway } from './services/listing.gateway';
import { AnalyticsService } from './services/analytics.service';
import { TokenAnalysisService } from './services/token-analysis.service';

@Module({
  imports: [PrismaModule, ScanModule],
  controllers: [ListingController],
  providers: [ListingService, ListingRepository, CacheService, RefreshWorker, RateLimiterGuard, MetricsService, ListingGateway, AnalyticsService, TokenAnalysisService],
  exports: [ListingService, MetricsService, ListingGateway, AnalyticsService, TokenAnalysisService],
})
export class ListingModule {}