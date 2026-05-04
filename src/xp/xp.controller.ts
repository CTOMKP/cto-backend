import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { XpService } from './xp.service';

@ApiTags('xp')
@Controller('xp')
export class XpController {
  constructor(
    private readonly xpService: XpService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get XP balance and recent history' })
  @ApiResponse({
    status: 200,
    description: 'XP balance, rank progression, and transaction history retrieved',
    schema: {
      example: {
        success: true,
        balance: 533,
        xpBalance: 533,
        rankScore: 155,
        rankTier: 2,
        rankLevel: 0,
        rankLabel: 'Sprout',
        rankEmoji: '🌿',
        nextRankTier: 2,
        nextRankLevel: 1,
        nextRankLabel: 'Junior Sapling',
        progressPercent: 70,
        scoreProgressPercent: 77.5,
        dayProgressPercent: 100,
        rankScoreToNext: 45,
        daysToNext: 0,
        daysOnPlatform: 18,
        currentStreakDays: 5,
        history: [
          {
            id: 1032,
            amount: 10,
            reason: 'DAILY_LOGIN',
            createdAt: '2026-05-04T08:24:12.120Z',
          },
        ],
        rankHistory: [
          {
            id: 228,
            amount: 1,
            reason: 'DAILY_LOGIN',
            createdAt: '2026-05-04T08:24:12.120Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async me(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const progress = await this.xpService.getUserProgress(userId, { awardDailyLogin: true });
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const history = await this.prisma.xpTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    const rankHistory = await this.prisma.rankScoreTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 100),
    });

    return {
      success: true,
      balance: progress.xpBalance,
      xpBalance: progress.xpBalance,
      rankScore: progress.rankScore,
      rankTier: progress.rankTier,
      rankLevel: progress.rankLevel,
      rankLabel: progress.rankLabel,
      rankEmoji: progress.rankEmoji,
      nextRankTier: progress.nextRankTier,
      nextRankLevel: progress.nextRankLevel,
      nextRankLabel: progress.nextRankLabel,
      progressPercent: progress.progressPercent,
      scoreProgressPercent: progress.scoreProgressPercent,
      dayProgressPercent: progress.dayProgressPercent,
      rankScoreToNext: progress.rankScoreToNext,
      daysToNext: progress.daysToNext,
      daysOnPlatform: progress.daysOnPlatform,
      currentStreakDays: progress.currentStreakDays,
      history,
      rankHistory,
    };
  }
}
