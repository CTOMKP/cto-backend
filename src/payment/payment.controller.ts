import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreateListingPaymentDto, CreateAdBoostPaymentDto } from './dto/payment.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('pricing')
  @ApiOperation({ 
    summary: 'Get pricing information',
    description: 'Get current pricing for listings and ad boosts in USDC'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Pricing information retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        pricing: {
          type: 'object',
          properties: {
            listing: { type: 'number', example: 0.15 },
            adBoost: {
              type: 'object',
              properties: {
                top: { type: 'number', example: 100 },
                priority: { type: 'number', example: 75 },
                bump: { type: 'number', example: 50 },
                spotlight: { type: 'number', example: 150 },
                homepage: { type: 'number', example: 200 },
                urgent: { type: 'number', example: 125 }
              }
            }
          }
        },
        currency: { type: 'string', example: 'USDC' }
      }
    }
  })
  getPricing() {
    return this.paymentService.getPricing();
  }

  @Post('listing')
  @ApiOperation({ summary: 'Pay for token listing (1.0 USDC)' })
  @ApiResponse({ status: 200, description: 'Payment initiated successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid request' })
  async payForListing(@Body() dto: CreateListingPaymentDto) {
    return this.paymentService.payForListing(dto);
  }

  @Post('ad-boost')
  @ApiOperation({ summary: 'Pay for ad boost' })
  @ApiResponse({ status: 200, description: 'Payment initiated successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid request' })
  async payForAdBoost(@Body() dto: CreateAdBoostPaymentDto) {
    return this.paymentService.payForAdBoost(dto);
  }

  @Get('verify/:paymentId')
  @ApiOperation({ 
    summary: 'Verify payment status',
    description: 'Verify payment status and complete transaction. Checks blockchain confirmation.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Payment verified successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
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
  @ApiResponse({ status: 400, description: 'Payment verification failed' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Query('userId') userId: string
  ) {
    return this.paymentService.verifyPayment(paymentId, userId);
  }

  @Get('history/:userId')
  @ApiOperation({ 
    summary: 'Get payment history',
    description: 'Get payment history for a user. Optionally filter by payment type (LISTING, AD_BOOST, etc.)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Payment history retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        payments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              paymentType: { type: 'string' },
              amount: { type: 'number' },
              currency: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async getPaymentHistory(
    @Param('userId') userId: string,
    @Query('paymentType') paymentType?: string
  ) {
    return this.paymentService.getPaymentHistory(userId, paymentType);
  }
}

