import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SentioService } from './sentio.service';
import { SentioController } from './sentio.controller';
import { TradeHistoryService } from '../trades/trade-history.service';

@Module({
  imports: [HttpModule],
  controllers: [SentioController],
  providers: [SentioService, TradeHistoryService],
  exports: [SentioService, TradeHistoryService],
})
export class SentioModule {}
