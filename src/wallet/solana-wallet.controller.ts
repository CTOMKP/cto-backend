import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SolanaWalletService } from './solana-wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Solana Wallet')
@Controller('wallet/solana')
export class SolanaWalletController {
  constructor(private readonly solanaWalletService: SolanaWalletService) {}

  @Get('balance/:address')
  @ApiOperation({
    summary: 'Get Solana wallet balance',
    description: 'Returns SOL and USDC balance for a Solana address.',
  })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
  async getBalance(@Param('address') address: string) {
    const data = await this.solanaWalletService.getWalletBalance(address);
    return { success: true, data };
  }

  @Get('transactions/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get Solana wallet transaction history',
    description: 'Returns persisted Solana transaction history for this wallet.',
  })
  @ApiResponse({ status: 200, description: 'Transactions retrieved successfully' })
  async getTransactions(
    @Param('walletId') walletId: string,
    @Query('limit') limit?: string,
  ) {
    const transactions = await this.solanaWalletService.getWalletTransactions(
      walletId,
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, transactions };
  }

  @Post('poll/:walletId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Poll Solana and persist wallet transactions',
    description:
      'Scans recent Solana signatures for a wallet, persists new records, and returns newly detected transactions.',
  })
  @ApiResponse({ status: 201, description: 'Polling completed' })
  async pollTransactions(
    @Param('walletId') walletId: string,
    @Body() body: { limit?: number },
  ) {
    const transactions = await this.solanaWalletService.pollWalletTransactions(walletId, body?.limit || 15);
    return {
      success: true,
      transactions,
      message: transactions.length
        ? `Found ${transactions.length} new transaction(s)`
        : 'No new Solana transactions found',
    };
  }
}
