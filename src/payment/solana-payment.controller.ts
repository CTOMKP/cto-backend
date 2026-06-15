import { Controller, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SolanaPaymentService } from './solana-payment.service';
import { CreateSolanaMarketplaceAdPaymentDto, VerifySolanaPaymentDto } from './dto/payment.dto';

@ApiTags('Solana Payment')
@Controller('payment/solana')
export class SolanaPaymentController {
  constructor(private readonly solanaPaymentService: SolanaPaymentService) {}

  @Post('listing/:listingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'listingId', description: 'User listing ID', example: 'cmx_listing_123' })
  @ApiOperation({
    summary: 'Create Solana payment for listing',
    description: 'Creates a payment record and returns a Solana transaction for USDC transfer.',
  })
  @ApiResponse({ status: 200, description: 'Payment created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request or wallet not ready' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async createListingPayment(@Request() req: any, @Param('listingId') listingId: string) {
    const userId = req.user.userId;
    return this.solanaPaymentService.createListingPayment(userId, listingId);
  }

  @Post('marketplace-ad/:adId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'adId', description: 'Marketplace ad ID', example: 'cmx_ad_123' })
  @ApiOperation({
    summary: 'Create Solana payment for marketplace ad',
    description: 'Creates a payment record and returns a Solana transaction for USDC transfer.',
  })
  @ApiBody({ type: CreateSolanaMarketplaceAdPaymentDto })
  @ApiResponse({ status: 200, description: 'Payment created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request or payment amount must be greater than 0' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Marketplace ad not found' })
  async createMarketplaceAdPayment(
    @Request() req: any,
    @Param('adId') adId: string,
    @Body() body: CreateSolanaMarketplaceAdPaymentDto,
  ) {
    const userId = req.user.userId;
    return this.solanaPaymentService.createMarketplaceAdPayment(userId, adId, body?.amountUsd || 0);
  }

  @Post('verify/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'paymentId', description: 'Payment ID to verify', example: 'cmx_payment_123' })
  @ApiOperation({
    summary: 'Verify Solana payment',
    description: 'Verifies a Solana USDC transfer on-chain and finalizes payment.',
  })
  @ApiBody({ type: VerifySolanaPaymentDto })
  @ApiResponse({ status: 200, description: 'Payment verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request, payment already completed, or transaction not confirmed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async verifyPayment(@Param('paymentId') paymentId: string, @Body() body: VerifySolanaPaymentDto) {
    return this.solanaPaymentService.verifyPayment(paymentId, body?.txHash);
  }

  @Post('verify-ad/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'paymentId', description: 'Payment ID to verify', example: 'cmx_payment_123' })
  @ApiOperation({
    summary: 'Verify Solana marketplace ad payment',
    description: 'Verifies a Solana USDC transfer for a marketplace ad and finalizes payment.',
  })
  @ApiBody({ type: VerifySolanaPaymentDto })
  @ApiResponse({ status: 200, description: 'Marketplace ad payment verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request, payment already completed, or payment type mismatch' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async verifyAdPayment(@Param('paymentId') paymentId: string, @Body() body: VerifySolanaPaymentDto) {
    return this.solanaPaymentService.verifyMarketplaceAdPayment(paymentId, body?.txHash);
  }
}
