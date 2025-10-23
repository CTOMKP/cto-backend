import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('memecoin')
  @ApiOperation({ summary: 'Get memecoin statistics from Dune Analytics' })
  @ApiResponse({ 
    status: 200, 
    description: 'Memecoin stats retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        dailyTokensDeployed: { type: 'number', example: 10000 },
        dailyGraduates: { type: 'number', example: 80 },
        topTokensLast7Days: { type: 'number', example: 8 }
      }
    }
  })
  async getMemecoinStats() {
    return this.statsService.getMemecoinStats();
  }
}


