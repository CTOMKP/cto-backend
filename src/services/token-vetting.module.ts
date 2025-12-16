import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { CronService } from './cron.service';
import { N8nService } from './n8n.service';
import { ExternalApisService } from './external-apis.service';
import { TokenImageService } from './token-image.service';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [
    CronService,
    N8nService,
    ExternalApisService,
    TokenImageService,
  ],
  exports: [
    CronService,
    N8nService,
    ExternalApisService,
    TokenImageService,
  ],
})
export class TokenVettingModule {}


