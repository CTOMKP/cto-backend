import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FundingService } from './funding.service';
import { CreateDepositDto, DepositStatusDto, GetBalanceDto, WithdrawDto } from './dto/funding.dto';

@ApiTags('funding')
@Controller('funding')
export class FundingController {
  constructor(private readonly fundingService: FundingService) {}

  @Get('methods/:userId')
  @ApiOperation({ 
    summary: 'Get available funding methods',
    description: 'Get list of available funding methods for a user (bank transfer, card, etc.)'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Funding methods retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        methods: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'BANK_TRANSFER' },
              enabled: { type: 'boolean' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getFundingMethods(@Param('userId') userId: string) {
    return this.fundingService.getFundingMethods(userId);
  }

  @Post('deposit')
  @ApiOperation({ 
    summary: 'Create a deposit request',
    description: 'Create a deposit request to fund a Circle wallet. Returns deposit instructions and tracking ID.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Deposit request created successfully',
    schema: {
      type: 'object',
      properties: {
        depositId: { type: 'string' },
        instructions: { type: 'object' },
        status: { type: 'string', example: 'PENDING' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async createDeposit(@Body() dto: CreateDepositDto) {
    return this.fundingService.createDeposit(dto);
  }

  @Get('deposit/:depositId/status')
  @ApiOperation({ summary: 'Get deposit status' })
  @ApiResponse({ status: 200, description: 'Deposit status retrieved successfully' })
  async getDepositStatus(
    @Param('depositId') depositId: string,
    @Query('userId') userId: string
  ) {
    return this.fundingService.getDepositStatus(depositId, userId);
  }

  @Get('balance/:userId')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiResponse({ status: 200, description: 'Wallet balance retrieved successfully' })
  async getWalletBalance(
    @Param('userId') userId: string,
    @Query('walletId') walletId?: string
  ) {
    return this.fundingService.getWalletBalance(userId, walletId);
  }

  @Post('withdraw')
  @ApiOperation({ 
    summary: 'Withdraw USDC to external wallet',
    description: 'Initiate withdrawal of USDC from Circle wallet to external blockchain wallet address. Validates balance before processing.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Withdrawal initiated successfully',
    schema: {
      type: 'object',
      properties: {
        withdrawalId: { type: 'string' },
        status: { type: 'string', example: 'PENDING' },
        txHash: { type: 'string', nullable: true }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Insufficient balance or invalid request' })
  @ApiResponse({ status: 404, description: 'User or wallet not found' })
  async withdraw(@Body() dto: WithdrawDto) {
    return this.fundingService.withdraw(dto);
  }

  @Get('withdraw/:withdrawalId/status')
  @ApiOperation({ summary: 'Get withdrawal status' })
  @ApiResponse({ status: 200, description: 'Withdrawal status retrieved successfully' })
  async getWithdrawalStatus(
    @Param('withdrawalId') withdrawalId: string,
    @Query('userId') userId: string
  ) {
    return this.fundingService.getWithdrawalStatus(withdrawalId, userId);
  }
}
