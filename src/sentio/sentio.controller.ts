import { Controller, Get, Param, Query } from '@nestjs/common';
import { TradeHistoryService } from '../trades/trade-history.service';

@Controller('tokens')
export class SentioController {
  constructor(private readonly tradeHistoryService: TradeHistoryService) {}

  @Get(':address/trades')
  async getTrades(
    @Param('address') address: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;

    return this.tradeHistoryService.getTrades(address, safeLimit);
  }
}
