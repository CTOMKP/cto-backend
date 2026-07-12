import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorProgramService } from './creator-program.service';
import { CreatorPayoutRequestDto } from './dto/creator-program.dto';
import { CreatorSignupDto } from './dto/creator-signup.dto';

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

  @Post('signup')
  @ApiOperation({ summary: 'Create a new creator account (creates both User + CreatorProgramAccount)' })
  @ApiBody({ type: CreatorSignupDto })
  @ApiResponse({ status: 201, description: 'Creator account created successfully, returns JWT token' })
  @ApiResponse({ status: 400, description: 'Validation error or email already exists' })
  async signup(@Body() body: CreatorSignupDto) {
    return this.creatorProgramService.signup(body);
  }

  @Post('session-handoff')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a short-lived session handoff for the standalone creator site' })
  @ApiResponse({ status: 201, description: 'Creator handoff ticket created successfully' })
  async createSessionHandoff(@Req() req: any) {
    return this.creatorProgramService.createSessionHandoff(this.getUserId(req));
  }

  @Post('session/exchange')
  @ApiOperation({ summary: 'Exchange a short-lived creator handoff ticket for a creator-site session' })
  @ApiBody({ schema: { example: { ticket: 'short-lived-handoff-ticket' } } })
  @ApiResponse({ status: 201, description: 'Creator site session created successfully' })
  async exchangeSessionHandoff(@Body() body: { ticket?: string }) {
    return this.creatorProgramService.exchangeSessionHandoff(body?.ticket || '');
  }
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator program enrollment status' })
  @ApiResponse({ status: 200, description: 'Creator enrollment status retrieved successfully' })
  async status(@Req() req: any) {
    return this.creatorProgramService.getEnrollmentStatus(this.getUserId(req));
  }

  @Post('enroll')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Enroll the authenticated marketplace user in the Creator Program' })
  @ApiResponse({ status: 201, description: 'Creator program enrollment completed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async enroll(@Req() req: any) {
    return this.creatorProgramService.enroll(this.getUserId(req));
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

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator dashboard summary (dashboard alias)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of recent items to return', example: 20 })
  @ApiResponse({ status: 200, description: 'Creator dashboard summary retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async dashboard(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getDashboardData(userId);
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
    return this.creatorProgramService.getReferralsData(userId, Number(limit) || 50);
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
    return this.creatorProgramService.getEarningsData(userId, Number(limit) || 50);
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
    return this.creatorProgramService.getPayoutsData(userId, Number(limit) || 20);
  }

  @Get('referral-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator referral code and links' })
  @ApiResponse({ status: 200, description: 'Creator referral links retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async referralCode(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getReferralCode(userId);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator settings' })
  @ApiResponse({ status: 200, description: 'Creator settings retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async settings(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getSettings(userId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update creator settings' })
  @ApiBody({
    schema: {
      example: {
        username: 'cryptobuilder',
        profileImageUrl: 'https://example.com/avatar.png',
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Creator settings updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateSettings(@Req() req: any, @Body() body: { username?: string; profileImageUrl?: string }) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.updateSettings(userId, body || {});
  }

  @Post('settings/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Reset creator account password' })
  @ApiBody({
    schema: {
      example: {
        currentPassword: 'old-password',
        newPassword: 'new-password123',
        confirmPassword: 'new-password123',
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async resetPassword(@Req() req: any, @Body() body: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.resetPassword(userId, body);
  }

  @Post('settings/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Deactivate creator account' })
  @ApiBody({
    schema: {
      example: {
        username: 'cryptobuilder',
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Creator account deactivated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deactivate(@Req() req: any, @Body() body: { username?: string }) {
    const userId = this.getUserId(req);
    const settings = await this.creatorProgramService.getSettings(userId);
    if (!body?.username || body.username.trim() !== settings.username) {
      throw new BadRequestException('Username confirmation does not match your account');
    }
    return this.creatorProgramService.deactivateCreatorAccount(userId);
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get creator notifications' })
  @ApiResponse({ status: 200, description: 'Creator notifications retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async notifications(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.getNotifications(userId);
  }

  @Patch('notifications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update creator notifications' })
  @ApiResponse({ status: 200, description: 'Notifications updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async notificationsPatch(@Req() req: any, @Body() body: { id?: string; all?: boolean }) {
    const userId = this.getUserId(req);
    if (body?.all) {
      await this.creatorProgramService.markAllNotificationsRead(userId);
      return this.creatorProgramService.getNotifications(userId);
    }
    if (!body?.id) {
      throw new BadRequestException('Notification id is required');
    }
    await this.creatorProgramService.markNotificationRead(userId, body.id);
    return this.creatorProgramService.getNotifications(userId);
  }

  @Delete('notifications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete creator notifications' })
  @ApiResponse({ status: 200, description: 'Notifications deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async notificationsDelete(@Req() req: any, @Body() body: { id?: string; all?: boolean }) {
    const userId = this.getUserId(req);
    if (body?.all) {
      await this.creatorProgramService.clearAllNotifications(userId);
      return this.creatorProgramService.getNotifications(userId);
    }
    if (!body?.id) {
      throw new BadRequestException('Notification id is required');
    }
    await this.creatorProgramService.removeNotification(userId, body.id);
    return this.creatorProgramService.getNotifications(userId);
  }

  @Post('notifications')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a demo creator notification' })
  @ApiResponse({ status: 200, description: 'Notification created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async notificationsPost(@Req() req: any, @Body() body: { type?: 'referral' | 'earning' | 'payout' }) {
    const userId = this.getUserId(req);
    const type = body?.type || 'referral';
    const notification = await this.creatorProgramService.simulateCreatorNotification(userId, type);
    return { success: true, notification };
  }

  @Post('payouts/wallet')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update creator payout wallet' })
  @ApiBody({
    schema: {
      example: {
        walletAddress: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Creator payout wallet updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async payoutWallet(@Req() req: any, @Body() body: { walletAddress?: string; chain?: string }) {
    const userId = this.getUserId(req);
    return this.creatorProgramService.updatePayoutWallet(userId, body?.walletAddress || '', body?.chain || 'solana');
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
