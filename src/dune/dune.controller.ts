import { Controller, Get, Post, UseGuards, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { DuneService } from './dune.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('stats')
@Controller('stats')
export class DuneController {
  constructor(private duneService: DuneService) {}

  /**
   * Get memecoin stats (Public)
   */
  @ApiOperation({ summary: 'Get memecoin launch statistics from Dune Analytics' })
  @ApiQuery({ 
    name: 'timeframe', 
    required: false, 
    description: 'Time period for stats (e.g., "7 days", "24 hours", "30 days")',
    example: '7 days'
  })
  @ApiResponse({
    status: 200,
    description: 'Memecoin stats retrieved',
    schema: {
      example: {
        totalLaunches: 1821,
        successfulLaunches: 211,
        failedLaunches: 1610,
        avgLaunchesPerDay: 260,
        timeframe: '7 days',
        generatedAt: '2026-05-04T09:10:00.000Z',
      },
    },
  })
  @Get('memecoin')
  async getMemecoinStats(@Query('timeframe') timeframe?: string) {
    return this.duneService.getMemecoinStats(timeframe || '7 days');
  }

  /**
   * Force refresh stats cache (Admin only)
   */
  @ApiOperation({ summary: 'Force refresh stats cache' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('memecoin/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 200,
    description: 'Stats cache refreshed',
    schema: {
      example: {
        message: 'Stats cache refreshed successfully',
        stats: {
          totalLaunches: 1821,
          timeframe: '7 days',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  async refreshStats() {
    const stats = await this.duneService.refreshCache();
    return {
      message: 'Stats cache refreshed successfully',
      stats,
    };
  }
}

