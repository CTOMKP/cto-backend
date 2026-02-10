import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TradeHistoryService } from '../trades/trade-history.service';

@ApiTags('tokens')
@Controller('tokens')
export class SentioController {
  constructor(private readonly tradeHistoryService: TradeHistoryService) {}

  @Get(':address/trades')
  @ApiOperation({
    summary: 'Get recent trades for a token',
    description: 'Returns normalized trade events for a token across supported chains.',
  })
  @ApiParam({
    name: 'address',
    description: 'Token address (Solana mint or Movement contract address)',
    example: '424kbbjyt6vksn7gekt9vh5yetutr1sbeyoya2nmbjpw',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max number of trades to return (1-200, default 50)',
    example: 50,
  })
  @ApiQuery({
    name: 'chain',
    required: false,
    description: 'Optional chain hint (solana | base | ethereum | bsc | movement | sui)',
    example: 'solana',
  })
  @ApiQuery({
    name: 'nocache',
    required: false,
    description: 'Bypass in-memory cache (1 to bypass)',
    example: '1',
  })
  @ApiResponse({
    status: 200,
    description: 'Trades retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              txHash: { type: 'string', example: '0xabc123...' },
              timestamp: { type: 'string', format: 'date-time' },
              type: { type: 'string', example: 'buy' },
              price: { type: 'number', example: 0.0123 },
              amount: { type: 'number', example: 1500 },
              totalValue: { type: 'number', example: 18.45 },
              makerAddress: { type: 'string', example: '0xmaker...' },
            },
          },
        },
      },
    },
  })
  async getTrades(
    @Param('address') address: string,
    @Query('limit') limit?: string,
    @Query('chain') chain?: string,
    @Query('nocache') nocache?: string,
  ) {
    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;

    const noCache = nocache === '1' || nocache === 'true';
    const trades = await this.tradeHistoryService.getTrades(address, safeLimit, chain, noCache);

    // Return in format expected by frontend: { data: [...] }
    return {
      data: trades,
      count: trades.length,
    };
  }
}
