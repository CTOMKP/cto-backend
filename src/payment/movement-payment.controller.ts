import { Controller, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MovementPaymentService } from './movement-payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Movement Payment')
@Controller('payment/movement')
export class MovementPaymentController {
  constructor(private readonly movementPaymentService: MovementPaymentService) {}

  @Post('listing/:listingId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create Movement payment for listing' })
  @ApiResponse({ status: 200, description: 'Payment created successfully' })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createListingPayment(
    @Request() req: any,
    @Param('listingId') listingId: string,
  ) {
    const userId = req.user.userId;
    return this.movementPaymentService.createListingPayment(userId, listingId);
  }

  @Post('verify/:paymentId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify Movement payment transaction' })
  @ApiResponse({ status: 200, description: 'Payment verified successfully' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Body() body: { txHash: string },
  ) {
    return this.movementPaymentService.verifyPayment(paymentId, body.txHash);
  }
}
