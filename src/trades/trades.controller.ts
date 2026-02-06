import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TradeHistoryService } from './trade-history.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('trades')
@Controller('trades')
export class TradesController {
  constructor(
    private readonly tradeHistoryService: TradeHistoryService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get user's trade history
   * Directive 2: GET /api/v1/trades/my-trades
   */
  @Get('my-trades')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: "Get user's trade history",
    description: 'Returns unified trade history from UserTrade table (Solana + Movement)',
  })
  @ApiQuery({
    name: 'chain',
    required: false,
    description: 'Filter by chain: solana | movement',
    example: 'solana',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max number of trades (1-200, default 50)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Trade history retrieved successfully',
  })
  async getMyTrades(
    @Request() req: any,
    @Query('chain') chain?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      return { data: [], message: 'User not authenticated' };
    }

    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;

    const trades = await this.tradeHistoryService.getUserTradeHistory(
      userId,
      safeLimit,
    );

    // Filter by chain if provided
    const filteredTrades = chain
      ? trades.filter((t) => t.chain.toLowerCase() === chain.toLowerCase())
      : trades;

    return {
      data: filteredTrades,
      count: filteredTrades.length,
    };
  }

  /**
   * Get swap quote
   * Directive 2: POST /api/v1/trades/quote
   * TODO: Implement quote fetching from Jupiter (Solana) and Panora (Movement)
   */
  @Post('quote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get swap quote',
    description: 'Fetches price quote from Jupiter (Solana) or Panora (Movement)',
  })
  @ApiResponse({
    status: 200,
    description: 'Quote retrieved successfully',
  })
  async getQuote(@Body() body: any) {
    // TODO: Implement quote service
    return {
      message: 'Quote endpoint - implementation pending',
      body,
    };
  }

  /**
   * Execute trade (buy or sell)
   * Directive 2: POST /api/v1/trades/execute
   * TODO: Implement transaction broadcasting and UserTrade recording
   */
  @Post('execute')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Execute trade',
    description: 'Accepts signed transaction from frontend, broadcasts it, and records UserTrade',
  })
  @ApiResponse({
    status: 200,
    description: 'Trade executed successfully',
  })
  async executeTrade(@Request() req: any, @Body() body: any) {
    // TODO: Implement execution service
    const userId = req.user?.id || req.user?.sub;
    return {
      message: 'Execute endpoint - implementation pending',
      userId,
      body,
    };
  }
}
