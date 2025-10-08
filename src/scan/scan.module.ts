import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './services/scan.service';
import { SolanaApiService } from './services/solana-api.service';

@Module({
  controllers: [ScanController],
  providers: [ScanService, SolanaApiService],
  exports: [ScanService]
})
export class ScanModule {}

