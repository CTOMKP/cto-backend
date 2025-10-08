import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FundingService } from './funding.service';
import { CreateDepositDto, DepositStatusDto, GetBalanceDto } from './dto/funding.dto';

@ApiTags('funding')
@Controller('funding')
export class FundingController {
  constructor(private readonly fundingService: FundingService) {}

  @Get('methods/:userId')
  @ApiOperation({ summary: 'Get available funding methods for user' })
  @ApiResponse({ status: 200, description: 'Funding methods retrieved successfully' })
  async getFundingMethods(@Param('userId') userId: string) {
    return this.fundingService.getFundingMethods(userId);
  }

  @Post('deposit')
  @ApiOperation({ summary: 'Create a deposit request' })
  @ApiResponse({ status: 200, description: 'Deposit request created successfully' })
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
}
