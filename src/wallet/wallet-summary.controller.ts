import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletSummaryService } from './wallet-summary.service';

@ApiTags('Wallet Summary')
@Controller('wallet/summary')
export class WalletSummaryController {
  constructor(private readonly walletSummaryService: WalletSummaryService) {}

  @Get('total-paid-out')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get the authenticated user all-time wallet withdrawals',
    description:
      'Aggregates completed DEBIT WalletTransaction records across wallets owned by the authenticated user. The headline total is completed USDC/USDC.e withdrawals; byToken contains per-token totals.',
  })
  @ApiResponse({
    status: 200,
    description: 'All-time withdrawal summary retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getTotalPaidOut(@Request() req: any) {
    return this.walletSummaryService.getTotalPaidOut(Number(req.user.userId));
  }
}
