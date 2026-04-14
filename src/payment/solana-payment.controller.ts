import { Controller, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SolanaPaymentService } from './solana-payment.service';

@ApiTags('Solana Payment')
@Controller('payment/solana')
export class SolanaPaymentController {
  constructor(private readonly solanaPaymentService: SolanaPaymentService) {}

  @Post('listing/:listingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create Solana payment for listing',
    description: 'Creates a payment record and returns a Solana transaction for USDC transfer.',
  })
  @ApiResponse({ status: 200, description: 'Payment created successfully' })
  async createListingPayment(@Request() req: any, @Param('listingId') listingId: string) {
    const userId = req.user.userId;
    return this.solanaPaymentService.createListingPayment(userId, listingId);
  }

  @Post('marketplace-ad/:adId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create Solana payment for marketplace ad',
    description: 'Creates a payment record and returns a Solana transaction for USDC transfer.',
  })
  async createMarketplaceAdPayment(
    @Request() req: any,
    @Param('adId') adId: string,
    @Body() body: { amountUsd: number },
  ) {
    const userId = req.user.userId;
    return this.solanaPaymentService.createMarketplaceAdPayment(userId, adId, body?.amountUsd || 0);
  }

  @Post('verify/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Verify Solana payment',
    description: 'Verifies a Solana USDC transfer on-chain and finalizes payment.',
  })
  async verifyPayment(@Param('paymentId') paymentId: string, @Body() body: { txHash: string }) {
    return this.solanaPaymentService.verifyPayment(paymentId, body?.txHash);
  }

  @Post('verify-ad/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  async verifyAdPayment(@Param('paymentId') paymentId: string, @Body() body: { txHash: string }) {
    return this.solanaPaymentService.verifyMarketplaceAdPayment(paymentId, body?.txHash);
  }
}
