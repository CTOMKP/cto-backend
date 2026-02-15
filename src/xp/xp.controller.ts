import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  async me(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const balance = await this.xpService.getBalance(userId);
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const history = await this.prisma.xpTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { success: true, balance, history };
  }
}
