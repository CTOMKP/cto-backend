import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TradesController } from './trades.controller';
import { TradeHistoryService } from './trade-history.service';
import { TradeSyncCronService } from './trade-sync-cron.service';
import { QuoteService } from './quote.service';
import { ExecutionService } from './execution.service';
import { TradesGateway } from './trades.gateway';

@Module({
  imports: [HttpModule, PrismaModule, AuthModule],
  controllers: [TradesController],
  providers: [TradeHistoryService, TradeSyncCronService, QuoteService, ExecutionService, TradesGateway],
  exports: [TradeHistoryService, QuoteService, ExecutionService, TradesGateway],
})
export class TradesModule {}
