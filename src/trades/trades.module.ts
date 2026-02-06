import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { TradesController } from './trades.controller';
import { TradeHistoryService } from './trade-history.service';
import { TradeSyncCronService } from './trade-sync-cron.service';

@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [TradesController],
  providers: [TradeHistoryService, TradeSyncCronService],
  exports: [TradeHistoryService],
})
export class TradesModule {}
