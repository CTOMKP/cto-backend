import { Controller, Get, Param, Query } from '@nestjs/common';
import { SentioService } from './sentio.service';

@Controller('tokens')
export class SentioController {
  constructor(private readonly sentioService: SentioService) {}

  @Get(':address/trades')
  async getTrades(
    @Param('address') address: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;

    return this.sentioService.getTokenTrades(address, safeLimit);
  }
}
