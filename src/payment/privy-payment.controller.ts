import { Controller, Post, Body, Get, Param, Logger } from '@nestjs/common';
import { PrivyPaymentService } from './privy-payment.service';

@Controller('payment/privy')
export class PrivyPaymentController {
  private readonly logger = new Logger(PrivyPaymentController.name);

  constructor(private privyPaymentService: PrivyPaymentService) {}

  /**
   * Create a listing payment for Privy user
   */
  @Post('listing')
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
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Body('txHash') txHash?: string,
  ) {
    this.logger.log(`Verifying payment ${paymentId}, txHash: ${txHash}`);
    return this.privyPaymentService.verifyPayment(paymentId);
  }
}

