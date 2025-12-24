import { Module, forwardRef } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './services/scan.service';
import { SolanaApiService } from './services/solana-api.service';
import { TokenVettingModule } from '../services/token-vetting.module';

@Module({
  imports: [forwardRef(() => TokenVettingModule)], // Use forwardRef to avoid circular dependency with ListingModule
  controllers: [ScanController],
  providers: [ScanService, SolanaApiService],
  exports: [ScanService]
})
export class ScanModule {}

