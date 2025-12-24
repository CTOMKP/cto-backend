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
  @ApiOperation({ 
    summary: 'Create Movement payment for listing',
    description: 'Create a payment record for a user listing using Movement native tokens (MOV). Returns transaction data for frontend to sign with Privy.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Payment created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentId: { type: 'string', example: 'cmhx1234567890' },
        chain: { type: 'string', example: 'movement' },
        fromAddress: { type: 'string', example: '0x1234...' },
        toAddress: { type: 'string', example: '0x5678...' },
        amount: { type: 'string', example: '100000000' },
        amountDisplay: { type: 'number', example: 1.0 },
        tokenSymbol: { type: 'string', example: 'MOVE' },
        transactionData: {
          type: 'object',
          properties: {
            type: { type: 'string', example: 'entry_function_payload' },
            function: { type: 'string', example: '0x1::coin::transfer' },
            type_arguments: { type: 'array', items: { type: 'string' } },
            arguments: { type: 'array', items: { type: 'string' } }
          }
        },
        message: { type: 'string', example: 'Transaction ready. Please sign with your Privy Movement wallet.' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
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
  @ApiOperation({ 
    summary: 'Verify Movement payment transaction',
    description: 'Verify that a payment transaction was completed on-chain. Debits balance and updates listing status to PENDING_APPROVAL.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Payment verified successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        payment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'COMPLETED' },
            txHash: { type: 'string', example: '0x1234...' },
            completedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request or payment already completed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async verifyPayment(
    @Param('paymentId') paymentId: string,
    @Body() body: { txHash: string },
  ) {
    return this.movementPaymentService.verifyPayment(paymentId, body.txHash);
  }
}







