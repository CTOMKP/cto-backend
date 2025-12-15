import { Controller, Post, Body, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { PrivyPaymentService } from './privy-payment.service';

@ApiTags('payment')
@Controller('payment/privy')
export class PrivyPaymentController {
  private readonly logger = new Logger(PrivyPaymentController.name);

  constructor(private privyPaymentService: PrivyPaymentService) {}

  /**
   * Create a listing payment for Privy user
   */
  @Post('listing')
  @ApiOperation({ summary: 'Create a listing payment for Privy user' })
  @ApiResponse({ status: 201, description: 'Payment created successfully' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'number', example: 1 },
        listingId: { type: 'string', example: 'cmhx1234567890' },
        chain: { type: 'string', example: 'SOLANA' },
      },
    },
  })
  async createListingPayment(
    @Body('userId') userId: number,
    @Body('listingId') listingId: string,
    @Body('chain') chain?: string,
  ) {
    this.logger.log(`Creating Privy listing payment for user ${userId}, listing ${listingId}`);
    return this.privyPaymentService.createListingPayment(userId, listingId, chain);
  }

  /**
   * Verify a payment was completed
   */
  @Post('verify/:paymentId')
  @ApiOperation({ summary: 'Verify a payment was completed' })
  @ApiParam({ name: 'paymentId', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment verified' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        txHash: { type: 'string', example: '0x123...' },
      },
    },
  })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Body('txHash') txHash?: string,
  ) {
    this.logger.log(`Verifying payment ${paymentId}, txHash: ${txHash}`);
    return this.privyPaymentService.verifyPayment(paymentId);
  }
}

