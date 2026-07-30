import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletSummaryController } from './wallet-summary.controller';
import { WalletSummaryService } from './wallet-summary.service';

@Module({
  imports: [PrismaModule],
  controllers: [WalletSummaryController],
  providers: [WalletSummaryService],
  exports: [WalletSummaryService],
})
export class WalletSummaryModule {}
