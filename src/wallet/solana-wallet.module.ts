import { Module } from '@nestjs/common';
import { SolanaWalletService } from './solana-wallet.service';
import { SolanaWalletController } from './solana-wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SolanaNetworkModule } from '../solana/solana-network.module';

@Module({
  imports: [PrismaModule, SolanaNetworkModule],
  controllers: [SolanaWalletController],
  providers: [SolanaWalletService],
  exports: [SolanaWalletService],
})
export class SolanaWalletModule {}
