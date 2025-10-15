import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreateListingPaymentDto, CreateAdBoostPaymentDto } from './dto/payment.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('pricing')
  @ApiOperation({ summary: 'Get pricing information for listings and ad boosts' })
  @ApiResponse({ status: 200, description: 'Pricing information retrieved successfully' })
  getPricing() {
    return this.paymentService.getPricing();
  }

  @Post('listing')
  @ApiOperation({ summary: 'Pay for token listing (50 USDC)' })
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
  @ApiOperation({ summary: 'Verify payment status and complete transaction' })
  @ApiResponse({ status: 200, description: 'Payment verified successfully' })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Query('userId') userId: string
  ) {
    return this.paymentService.verifyPayment(paymentId, userId);
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Get payment history for user' })
  @ApiResponse({ status: 200, description: 'Payment history retrieved successfully' })
  async getPaymentHistory(
    @Param('userId') userId: string,
    @Query('paymentType') paymentType?: string
  ) {
    return this.paymentService.getPaymentHistory(userId, paymentType);
  }
}

