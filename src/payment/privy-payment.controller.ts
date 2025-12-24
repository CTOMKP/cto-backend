import { Controller, Post, Body, Get, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { PrivyPaymentService } from './privy-payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('payment')
@Controller('payment/privy')
export class PrivyPaymentController {
  private readonly logger = new Logger(PrivyPaymentController.name);

  constructor(private privyPaymentService: PrivyPaymentService) {}

  /**
   * Create a listing payment for Privy user
   */
  @Post('listing')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Create a listing payment for Privy user',
    description: 'Create a payment for a user listing using Privy wallet (EVM chains). Returns unsigned transaction data for frontend to sign with Privy. Supports multiple chains: Base, Ethereum, Polygon, Arbitrum, Optimism, Solana.'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Payment created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentId: { type: 'string' },
        chain: { type: 'string', example: 'base' },
        fromAddress: { type: 'string' },
        toAddress: { type: 'string' },
        amount: { type: 'number', example: 0.15 },
        currency: { type: 'string', example: 'USDC' },
        transactionData: {
          type: 'object',
          description: 'EVM transaction data for Privy to sign'
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Insufficient balance, no wallet found, or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or listing not found' })
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Verify a payment was completed',
    description: 'Verify that a Privy payment transaction was completed on-chain. Updates payment status to COMPLETED and listing status to PENDING_APPROVAL.'
  })
  @ApiParam({ name: 'paymentId', description: 'Payment ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Payment verified',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        payment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'COMPLETED' },
            txHash: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Payment verification failed or already completed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
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

