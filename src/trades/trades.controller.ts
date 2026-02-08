import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TradeHistoryService } from './trade-history.service';
import { QuoteService } from './quote.service';
import { ExecutionService } from './execution.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteRequestDto } from './dto/quote.dto';
import { BuildTransactionRequestDto, ExecuteTradeRequestDto } from './dto/execute.dto';

@ApiTags('trades')
@Controller('trades')
export class TradesController {
  constructor(
    private readonly tradeHistoryService: TradeHistoryService,
    private readonly quoteService: QuoteService,
    private readonly executionService: ExecutionService,
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
    description: 'Filter by chain: solana | movement | base',
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
   */
  @Post('quote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get swap quote',
    description: 'Fetches price quote from Jupiter (Solana/Base) or Panora (Movement)',
  })
  @ApiResponse({
    status: 200,
    description: 'Quote retrieved successfully',
  })
  async getQuote(@Body() quoteRequest: QuoteRequestDto) {
    // Auto-detect chain if not provided
    let chain = quoteRequest.chain;
    if (!chain) {
      chain = await this.quoteService.detectChainFromTokens(
        quoteRequest.inputToken,
        quoteRequest.outputToken,
      );
    }

    const quote = await this.quoteService.getQuote({
      ...quoteRequest,
      chain,
    });

    return {
      success: true,
      data: quote,
    };
  }

  /**
   * Build unsigned transaction for frontend signing
   * POST /api/v1/trades/build-transaction
   */
  @Post('build-transaction')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Build unsigned transaction',
    description: 'Builds unsigned transaction for frontend to sign with Privy wallet',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction built successfully',
  })
  async buildTransaction(@Body() request: BuildTransactionRequestDto) {
    const unsignedTx = await this.executionService.buildUnsignedTransaction(request);

    return {
      success: true,
      data: unsignedTx,
    };
  }

  /**
   * Execute trade (buy or sell)
   * Directive 2: POST /api/v1/trades/execute
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
  async executeTrade(@Request() req: any, @Body() executeRequest: ExecuteTradeRequestDto) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    if (executeRequest.chain === 'solana') {
      throw new BadRequestException({
        code: 'TRADING_DISABLED',
        message: 'Solana trading is disabled. This chain is read-only for now.',
        retryable: false,
      });
    }

    // Find user's wallet for the chain
    const wallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        blockchain: executeRequest.chain.toUpperCase() as any,
      },
    });

    if (!wallet && executeRequest.chain === 'movement') {
      throw new BadRequestException({
        code: 'WALLET_NOT_FOUND',
        message: 'Movement wallet not found. Please sync or create a Movement wallet.',
        retryable: false,
      });
    }

    const result = await this.executionService.broadcastTransaction({
      chain: executeRequest.chain,
      signedTransaction: executeRequest.signedTransaction,
      userId,
      quote: executeRequest.quote,
      walletId: executeRequest.walletId || wallet?.id,
    });

    return {
      success: true,
      data: {
        txHash: result.txHash,
        status: result.status,
      },
    };
  }

  /**
   * Sentio webhook for Movement trades
   * POST /api/v1/trades/sentio-webhook
   */
  @Post('sentio-webhook')
  @ApiOperation({
    summary: 'Ingest Sentio trade webhook',
    description: 'Receives Movement swap events from Sentio and persists to UserTrade',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook ingested successfully',
  })
  async ingestSentioWebhook(@Body() payload: any) {
    const result = await this.tradeHistoryService.ingestSentioWebhook(payload);

    return {
      success: true,
      data: result,
    };
  }
}
