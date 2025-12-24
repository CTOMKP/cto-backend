import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScanController } from './scan.controller';
import { ScanService } from './services/scan.service';
import { SolanaApiService } from './services/solana-api.service';
import { TokenVettingModule } from '../services/token-vetting.module';
import { ListingModule } from '../listing/listing.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => TokenVettingModule), // Use forwardRef to avoid circular dependency with ListingModule
    forwardRef(() => ListingModule), // Need AnalyticsService from ListingModule
  ],
  controllers: [ScanController],
  providers: [ScanService, SolanaApiService],
  exports: [ScanService]
})
export class ScanModule {}

