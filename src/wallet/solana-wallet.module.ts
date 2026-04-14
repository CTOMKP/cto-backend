import { Module } from '@nestjs/common';
import { SolanaWalletService } from './solana-wallet.service';
import { SolanaWalletController } from './solana-wallet.controller';

@Module({
  controllers: [SolanaWalletController],
  providers: [SolanaWalletService],
  exports: [SolanaWalletService],
})
export class SolanaWalletModule {}
