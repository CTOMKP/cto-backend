import { Body, Controller, Headers, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FaucetRequestDto } from './dto/faucet-request.dto';
import { SupportTicketService } from './support-ticket.service';

@ApiTags('public-faucet')
@Controller('public/faucet')
export class PublicFaucetController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post('solana-usdc')
  @ApiOperation({ summary: 'Public Solana USDC faucet endpoint' })
  @ApiResponse({
    status: 201,
    description: 'Faucet disbursed',
  })
  @ApiResponse({
    status: 200,
    description: 'Cooldown active',
  })
  async applyPublicFaucet(
    @Body() dto: FaucetRequestDto,
    @Headers('x-faucet-key') faucetKey: string | undefined,
    @Ip() ip: string,
  ) {
    const expectedKey = this.supportTicketService.getPublicFaucetKey();
    if (expectedKey && faucetKey !== expectedKey) {
      throw new UnauthorizedException('Invalid faucet key');
    }

    const result = await this.supportTicketService.createPublicFaucetRequest(dto, ip);

    if (result.blocked) {
      return {
        success: false,
        message: 'Cooldown active for this wallet. Try again later.',
        data: result.ticket,
      };
    }

    return {
      success: true,
      message: 'Faucet disbursed successfully.',
      data: {
        ticket: result.ticket,
        disbursement: 'disbursement' in result ? result.disbursement : null,
      },
    };
  }
}
