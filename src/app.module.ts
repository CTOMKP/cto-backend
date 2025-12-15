import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpModule } from '@nestjs/axios';

// Configuration
import { DatabaseConfig } from './config/database.config';
import { ThrottlerConfig } from './config/throttler.config';

// Core modules
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TokensController } from './tokens.controller';
import { AdminController } from './admin.controller';
import { MemesController } from './controllers/memes.controller';

// Services
import { CronService } from './services/cron.service';
import { ExternalApisService } from './services/external-apis.service';
import { RiskScoringService } from './services/risk-scoring.service';
import { N8nService } from './services/n8n.service';
import { S3Service } from './services/s3.service';
import { TokenImageService } from './services/token-image.service';

// Database entities
import { Token } from './entities/token.entity';
import { VettingResult } from './entities/vetting-result.entity';
import { MonitoringSnapshot } from './entities/monitoring-snapshot.entity';
import { LpData } from './entities/lp-data.entity';
import { Holder } from './entities/holder.entity';
import { LaunchAnalysis } from './entities/launch-analysis.entity';
import { BadgeHistory } from './entities/badge-history.entity';
import { Alert } from './entities/alert.entity';
import { HolderHistory } from './entities/holder-history.entity';
import { User } from './entities/user.entity';
import { Meme } from './entities/meme.entity';

// Common modules
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // Database
    TypeOrmModule.forRootAsync({
      useClass: DatabaseConfig,
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerConfig,
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // HTTP client
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),

    // Common module
    CommonModule,

    // Entities
    TypeOrmModule.forFeature([
      Token,
      VettingResult,
      MonitoringSnapshot,
      LpData,
      Holder,
      LaunchAnalysis,
      BadgeHistory,
      Alert,
      HolderHistory,
      User,
      Meme,
    ]),
  ],
  controllers: [AppController, TokensController, AdminController, MemesController],
  providers: [
    AppService,
    CronService,
    ExternalApisService,
    RiskScoringService,
    N8nService,
    S3Service,
    TokenImageService,
  ],
})
export class AppModule {}
