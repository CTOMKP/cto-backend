import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MovementWalletService } from './movement-wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Movement Wallet')
@Controller('wallet/movement')
export class MovementWalletController {
  private readonly logger = new Logger(MovementWalletController.name);

  constructor(private readonly movementWalletService: MovementWalletService) {}

  @Get('balance/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get Movement wallet balance',
    description: 'Get all token balances for a Movement wallet. Returns balances stored in database (synced from blockchain).'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        balances: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              walletId: { type: 'string' },
              tokenAddress: { type: 'string', example: '0x1::aptos_coin::AptosCoin' },
              tokenSymbol: { type: 'string', example: 'MOV' },
              balance: { type: 'string', example: '1000000000' },
              decimals: { type: 'number', example: 8 },
              lastUpdated: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getBalance(
    @Param('walletId') walletId: string,
    @Query('tokenAddress') tokenAddress?: string,
    @Query('testnet') testnet?: string,
  ) {
    const balances = await this.movementWalletService.getWalletBalances(walletId);
    return {
      success: true,
      balances,
    };
  }

  @Post('sync/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Sync Movement wallet balance from blockchain',
    description: 'Manually sync wallet balance from Movement blockchain to database. Optionally specify token address and network (testnet/mainnet).'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balance synced successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        balance: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            balance: { type: 'string' },
            tokenSymbol: { type: 'string' },
            lastUpdated: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async syncBalance(
    @Param('walletId') walletId: string,
    @Body() body: { tokenAddress?: string; testnet?: boolean },
  ) {
    const balance = await this.movementWalletService.syncWalletBalance(
      walletId,
      body.tokenAddress,
      body.testnet ?? true,
    );
    return {
      success: true,
      balance,
    };
  }

  @Get('transactions/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get Movement wallet transaction history',
    description: 'Get transaction history for a Movement wallet. Includes CREDIT (funding), DEBIT (payments), and TRANSFER transactions. Default limit is 50.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Transactions retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              txHash: { type: 'string' },
              txType: { type: 'string', example: 'CREDIT' },
              amount: { type: 'string' },
              tokenSymbol: { type: 'string' },
              status: { type: 'string', example: 'COMPLETED' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getTransactions(
    @Param('walletId') walletId: string,
    @Query('limit') limit?: string,
  ) {
    const transactions = await this.movementWalletService.getWalletTransactions(
      walletId,
      limit ? parseInt(limit, 10) : 50,
    );
    return {
      success: true,
      transactions,
    };
  }

  @Post('poll/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'High-Reliability Transaction Sync (Indexer + Master Scan)',
    description: 'Triggers a high-reliability transaction discovery process. It first queries the Movement GraphQL Indexer for guaranteed history, then performs a "Super-Greedy" master event scan as a fallback. This ensures both Senders and Receivers see transactions correctly (Resolves Asymmetric Visibility).'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Polling completed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        transactions: {
          type: 'array',
          description: 'New transactions detected (if any)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              txType: { type: 'string', example: 'CREDIT' },
              amount: { type: 'string' },
              description: { type: 'string' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async pollTransactions(
    @Param('walletId') walletId: string,
    @Body() body: { testnet?: boolean },
  ) {
    try {
      const transactions = await this.movementWalletService.pollForTransactions(
        walletId,
        body.testnet ?? true,
      );
      return {
        success: true,
        transactions,
      };
    } catch (error: any) {
      // Re-throw NotFoundException to preserve 404 status
      if (error.status === 404) {
        throw error;
      }
      // Log the full error for debugging
      this.logger.error(`Failed to poll transactions for wallet ${walletId}: ${error.message}`, error.stack);
      // Return a more informative error response
      throw new Error(`Failed to poll transactions: ${error.message}`);
    }
  }
}







