import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SolanaWalletService } from './solana-wallet.service';

@ApiTags('Solana Wallet')
@Controller('wallet/solana')
export class SolanaWalletController {
  constructor(private readonly solanaWalletService: SolanaWalletService) {}

  @Get('balance/:address')
  @ApiOperation({
    summary: 'Get Solana wallet balance',
    description: 'Returns SOL and USDC balance for a Solana address.',
  })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
  async getBalance(@Param('address') address: string) {
    const data = await this.solanaWalletService.getWalletBalance(address);
    return { success: true, data };
  }
}
