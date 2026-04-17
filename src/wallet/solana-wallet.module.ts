import { Module } from '@nestjs/common';
import { SolanaWalletService } from './solana-wallet.service';
import { SolanaWalletController } from './solana-wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SolanaWalletController],
  providers: [SolanaWalletService],
  exports: [SolanaWalletService],
})
export class SolanaWalletModule {}
