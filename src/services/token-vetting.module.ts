import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { ListingModule } from '../listing/listing.module';
import { CronService } from './cron.service';
import { N8nService } from './n8n.service';
import { ExternalApisService } from './external-apis.service';
import { TokenImageService } from './token-image.service';
import { Pillar1RiskScoringService } from './pillar1-risk-scoring.service';
import { Pillar2MonitoringService } from './pillar2-monitoring.service';

@Module({
  imports: [
    HttpModule,
    PrismaModule,
    forwardRef(() => ListingModule), // Use forwardRef to avoid circular dependency
  ],
  providers: [
    CronService,
    N8nService,
    ExternalApisService,
    TokenImageService,
    Pillar1RiskScoringService,
    Pillar2MonitoringService,
  ],
  exports: [
    CronService,
    N8nService,
    ExternalApisService,
    TokenImageService,
    Pillar1RiskScoringService,
    Pillar2MonitoringService,
  ],
})
export class TokenVettingModule {}


