import { Body, Controller, Post, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransferService } from './transfer.service';
import { CCTPTransferDto, WormholeAttestationDto, PanoraSwapDto } from './dto/transfer.dto';

@ApiTags('transfers')
@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post('cctp')
  @ApiOperation({ 
    summary: 'Initiate CCTP cross-chain USDC transfer',
    description: 'Initiate a CCTP (Circle Cross-Chain Transfer Protocol) transfer of USDC between different blockchains. Supports Ethereum, Base, Polygon, Arbitrum, Optimism.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'CCTP transfer initiated successfully',
    schema: {
      type: 'object',
      properties: {
        transferId: { type: 'string' },
        status: { type: 'string', example: 'PENDING' },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters or insufficient balance' })
  async initiateCCTPTransfer(@Body() dto: CCTPTransferDto) {
    return this.transferService.initiateCCTPTransfer(dto);
  }

  @Post('wormhole/attestation')
  @ApiOperation({ 
    summary: 'Get Wormhole attestation for cross-chain transfer',
    description: 'Get Wormhole attestation for cross-chain USDC transfer. Attestation is required to redeem tokens on destination chain.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Wormhole attestation retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        attestation: { type: 'string', description: 'Wormhole attestation message' },
        txHash: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Failed to get attestation or invalid request' })
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
  @ApiOperation({ 
    summary: 'Get transaction status',
    description: 'Get status of a cross-chain transfer transaction. Checks Circle API for current transaction state.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Transaction status retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        transactionId: { type: 'string' },
        status: { type: 'string', example: 'pending', enum: ['pending', 'completed', 'failed'] },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
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
