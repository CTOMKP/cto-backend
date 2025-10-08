import { Body, Controller, Post, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransferService } from './transfer.service';
import { CCTPTransferDto, WormholeAttestationDto, PanoraSwapDto } from './dto/transfer.dto';

@ApiTags('transfers')
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post('cctp')
  @ApiOperation({ summary: 'Initiate CCTP cross-chain USDC transfer' })
  @ApiResponse({ status: 200, description: 'CCTP transfer initiated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async initiateCCTPTransfer(@Body() dto: CCTPTransferDto) {
    return this.transferService.initiateCCTPTransfer(dto);
  }

  @Post('wormhole/attestation')
  @ApiOperation({ summary: 'Get Wormhole attestation for cross-chain transfer' })
  @ApiResponse({ status: 200, description: 'Wormhole attestation retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Failed to get attestation' })
  async getWormholeAttestation(@Body() dto: WormholeAttestationDto) {
    return this.transferService.getWormholeAttestation(dto);
  }

  @Post('wormhole/redeem')
  @ApiOperation({ summary: 'Redeem USDC on destination chain using Wormhole' })
  @ApiResponse({ status: 200, description: 'Wormhole redemption initiated successfully' })
  @ApiResponse({ status: 400, description: 'Redemption failed' })
  async redeemWormholeTransfer(
    @Body() dto: WormholeAttestationDto & { attestation: string }
  ) {
    return this.transferService.redeemWormholeTransfer(dto, dto.attestation);
  }

  @Post('panora/swap')
  @ApiOperation({ summary: 'Execute token swap via Panora' })
  @ApiResponse({ status: 200, description: 'Token swap executed successfully' })
  @ApiResponse({ status: 400, description: 'Swap failed' })
  async executePanoraSwap(@Body() dto: PanoraSwapDto) {
    return this.transferService.executePanoraSwap(dto);
  }

  @Get('status/:transactionId')
  @ApiOperation({ summary: 'Get transaction status' })
  @ApiResponse({ status: 200, description: 'Transaction status retrieved' })
  async getTransactionStatus(
    @Param('transactionId') transactionId: string,
    @Query('userId') userId: string
  ) {
    // This would check the status of a transaction
    return {
      success: true,
      transactionId,
      status: 'pending', // This should be fetched from Circle API
      message: 'Transaction status retrieved'
    };
  }
}
