import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorProgramService } from './creator-program.service';

@ApiTags('creator-program')
@Controller('creator')
export class CreatorProgramController {
  constructor(private readonly creatorProgramService: CreatorProgramService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator dashboard summary' })
  async me(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.creatorProgramService.getDashboard(userId, Number(limit) || 20);
  }

  @Get('referrals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator referrals' })
  async referrals(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.creatorProgramService.getReferrals(userId, Number(limit) || 50);
  }

  @Get('earnings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator earnings' })
  async earnings(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.creatorProgramService.getEarnings(userId, Number(limit) || 50);
  }

  @Get('payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator payouts' })
  async payouts(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.creatorProgramService.getPayouts(userId, Number(limit) || 20);
  }

  @Post('payouts/request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Request a creator payout' })
  @ApiResponse({ status: 200, description: 'Payout request created' })
  async requestPayout(
    @Req() req: any,
    @Body() body: { walletAddress?: string; amount?: number; note?: string },
  ) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.creatorProgramService.requestPayout(userId, {
      walletAddress: body?.walletAddress,
      amount: body?.amount,
      note: body?.note,
    });
  }
}
