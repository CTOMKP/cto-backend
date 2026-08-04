import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorProgramService } from './creator-program.service';
import { CreatorPayoutRequestDto } from './dto/creator-program.dto';

@ApiTags('creator-program')
@Controller('creator')
export class CreatorProgramController {
  constructor(private readonly creatorProgramService: CreatorProgramService) {}

  private getUserId(req: any) {
    const userId = Number(req?.user?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException('Invalid authenticated user');
    }
    return userId;
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  async getNotifications(@Req() req: any) {
    return this.creatorProgramService.getNotifications(this.getUserId(req));
  }

  @Post('notifications/read-all')
  @UseGuards(JwtAuthGuard)
  async markAllNotificationsRead(@Req() req: any) {
    return this.creatorProgramService.markAllNotificationsRead(this.getUserId(req));
  }

  @Post('notifications/:id/read')
  @UseGuards(JwtAuthGuard)
  async markNotificationRead(@Req() req: any, @Param('id') id: string) {
    return this.creatorProgramService.markNotificationRead(this.getUserId(req), id);
  }

  @Delete('notifications')
  @UseGuards(JwtAuthGuard)
  async deleteAllNotifications(@Req() req: any) {
    return this.creatorProgramService.deleteAllNotifications(this.getUserId(req));
  }

  @Delete('notifications/:id')
  @UseGuards(JwtAuthGuard)
  async deleteNotification(@Req() req: any, @Param('id') id: string) {
    return this.creatorProgramService.deleteNotification(this.getUserId(req), id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator dashboard summary' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of recent items to return', example: 20 })
  @ApiResponse({ status: 200, description: 'Creator dashboard summary retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid authenticated user or query value' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getDashboard(userId, Number(limit) || 20);
  }

  @Get('referrals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator referrals' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of referral rows to return', example: 50 })
  @ApiResponse({ status: 200, description: 'Creator referrals retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async referrals(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getReferrals(userId, Number(limit) || 50);
  }

  @Get('earnings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator earnings' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of earning rows to return', example: 50 })
  @ApiResponse({ status: 200, description: 'Creator earnings retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async earnings(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getEarnings(userId, Number(limit) || 50);
  }

  @Get('payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator payouts' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of payout rows to return', example: 20 })
  @ApiResponse({ status: 200, description: 'Creator payouts retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async payouts(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getPayouts(userId, Number(limit) || 20);
  }

  @Post('payouts/request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Request a creator payout' })
  @ApiBody({ type: CreatorPayoutRequestDto })
  @ApiResponse({ status: 200, description: 'Payout request created' })
  @ApiResponse({ status: 400, description: 'Invalid request, insufficient balance, or minimum payout not met' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async requestPayout(
    @Req() req: any,
    @Body() body: CreatorPayoutRequestDto,
  ) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.requestPayout(userId, {
      walletAddress: body?.walletAddress,
      amount: body?.amount,
      note: body?.note,
    });
  }
}
