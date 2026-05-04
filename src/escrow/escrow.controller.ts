import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EscrowService } from './escrow.service';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('offer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create escrow offer (poster only)' })
  @ApiResponse({
    status: 201,
    description: 'Escrow offer created',
    schema: {
      example: {
        success: true,
        escrow: {
          id: 'cmox-escrow-1',
          status: 'PENDING_ACCEPTANCE',
          amount: '5.00',
          currency: 'USDC',
        },
      },
    },
  })
  async createOffer(@Req() req: any, @Body() payload: any) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.escrowService.createOffer(userId, payload.conversationId, payload);
  }

  @Get('conversation/:conversationId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get latest escrow for a conversation' })
  @ApiResponse({ status: 200, description: 'Escrow fetched for conversation' })
  async getByConversation(@Req() req: any, @Param('conversationId') conversationId: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.getLatestByConversation(userId, conversationId);
    return { success: true, escrow };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get escrow by id (participants only)' })
  @ApiResponse({ status: 200, description: 'Escrow fetched by id' })
  async get(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.getEscrow(userId, id);
    return { success: true, escrow };
  }

  @Post(':id/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Accept escrow offer (applicant)' })
  @ApiResponse({ status: 200, description: 'Escrow offer accepted' })
  async accept(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.accept(userId, id);
    return { success: true, escrow };
  }

  @Post(':id/decline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Decline escrow offer (applicant)' })
  @ApiResponse({ status: 200, description: 'Escrow offer declined' })
  async decline(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.decline(userId, id);
    return { success: true, escrow };
  }

  @Post(':id/fund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Fund escrow (poster)' })
  @ApiResponse({
    status: 200,
    description: 'Escrow funded',
    schema: {
      example: {
        success: true,
        escrow: { id: 'cmox-escrow-1', status: 'FUNDED' },
        txHash: '0xabc123...',
      },
    },
  })
  async fund(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.escrowService.fund(userId, id);
  }

  @Post(':id/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit work (applicant)' })
  @ApiResponse({ status: 200, description: 'Work submitted for escrow review' })
  async submit(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.submitWork(userId, id);
    return { success: true, escrow };
  }

  @Post(':id/release')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Release escrow funds (poster)' })
  @ApiResponse({ status: 200, description: 'Escrow funds released' })
  async release(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.release(userId, id, false);
    return { success: true, escrow };
  }

  @Post(':id/refund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Refund escrow (poster)' })
  @ApiResponse({ status: 200, description: 'Escrow refunded' })
  async refund(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.refund(userId, id, false);
    return { success: true, escrow };
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel escrow (poster, before funding)' })
  @ApiResponse({ status: 200, description: 'Escrow cancelled' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.cancel(userId, id);
    return { success: true, escrow };
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Poster review after deadline (satisfied=true releases funds, satisfied=false opens dispute)',
  })
  async posterReview(@Req() req: any, @Param('id') id: string, @Body() payload: { satisfied: boolean; reason?: string }) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.posterReview(userId, id, payload);
    return { success: true, escrow };
  }

  @Post(':id/dispute-response')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Applicant responds to a dispute with explanation' })
  @ApiResponse({ status: 200, description: 'Dispute response submitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not a participant' })
  @ApiResponse({ status: 404, description: 'Escrow not found' })
  async applicantDisputeResponse(
    @Req() req: any,
    @Param('id') id: string,
    @Body() payload: { explanation: string },
  ) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const escrow = await this.escrowService.applicantDisputeResponse(userId, id, payload?.explanation || '');
    return { success: true, escrow };
  }
}
