import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MovementWalletService } from './movement-wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Movement Wallet')
@Controller('wallet/movement')
export class MovementWalletController {
  constructor(private readonly movementWalletService: MovementWalletService) {}

  @Get('balance/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get Movement wallet balance' })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
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
  @ApiOperation({ summary: 'Sync Movement wallet balance from blockchain' })
  @ApiResponse({ status: 200, description: 'Balance synced successfully' })
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
  @ApiOperation({ summary: 'Get Movement wallet transaction history' })
  @ApiResponse({ status: 200, description: 'Transactions retrieved successfully' })
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
  @ApiOperation({ summary: 'Poll for new transactions (detect funding)' })
  @ApiResponse({ status: 200, description: 'Polling completed' })
  async pollTransactions(
    @Param('walletId') walletId: string,
    @Body() body: { testnet?: boolean },
  ) {
    const transactions = await this.movementWalletService.pollForTransactions(
      walletId,
      body.testnet ?? true,
    );
    return {
      success: true,
      transactions,
    };
  }
}
