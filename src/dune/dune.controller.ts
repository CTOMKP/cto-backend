import { Controller, Get, Post, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
  @Get('memecoin')
  async getMemecoinStats() {
    return this.duneService.getMemecoinStats();
  }

  /**
   * Force refresh stats cache (Admin only)
   */
  @ApiOperation({ summary: 'Force refresh stats cache' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('memecoin/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshStats() {
    const stats = await this.duneService.refreshCache();
    return {
      message: 'Stats cache refreshed successfully',
      stats,
    };
  }
}

