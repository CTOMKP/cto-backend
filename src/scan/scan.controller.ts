import { 
  Controller, 
  Post, 
  Body, 
  HttpException, 
  HttpStatus,
  Logger, 
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ScanService } from './services/scan.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatTokenAge, formatTokenAgeShort } from '../utils/age-formatter';
import { ScanRequestDto, BatchScanRequestDto } from './dto/scan-request.dto';
import { ScanResultDto, BatchScanResponseDto } from './dto/scan-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Token Scanning')
@Controller('scan')
export class ScanController {
  private readonly logger = new Logger(ScanController.name);

  constructor(
    private readonly scanService: ScanService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('scan')
  @ApiOperation({ summary: 'Scan a single token', description: 'Performs comprehensive analysis of a single Solana token' })
  @ApiBody({ type: ScanRequestDto })
  @ApiResponse({ status: 200, description: 'Token scan completed successfully', type: ScanResultDto })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error during scan' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async scanSingleToken(@Body() scanRequest: ScanRequestDto, @Req() req: any): Promise<ScanResultDto> {
    try {
      this.logger.log(`Single token scan requested for: ${scanRequest.contractAddress}`);
      const userId = req?.user?.userId as number | undefined;
      const chain = (scanRequest as any)?.chain ?? 'SOLANA';
      const now = Date.now();
      const cacheWindowMs = 24 * 60 * 60 * 1000;
      const recentScan = await (this.prisma as any).scanResult.findFirst({
        where: {
          contractAddress: scanRequest.contractAddress,
          createdAt: { gte: new Date(now - cacheWindowMs) },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (recentScan?.resultData) {
        const stored = recentScan.resultData as any;
        const riskScore = stored?.risk_score ?? recentScan.riskScore ?? null;
        const tier = stored?.tier ?? recentScan.tier ?? null;
        const eligible =
          stored?.eligible ??
          (typeof riskScore === 'number' ? riskScore >= 50 : false);
        const summary = stored?.summary ?? recentScan.summary ?? null;
        const riskLevel = stored?.risk_level ?? null;
        const metadata = stored?.metadata ?? stored;

        if (metadata && !metadata.creation_date && typeof metadata.project_age_days === 'number') {
          const createdAt = new Date(Date.now() - metadata.project_age_days * 24 * 60 * 60 * 1000);
          metadata.creation_date = createdAt;
        }
        if (metadata && !metadata.age_display && typeof metadata.project_age_days === 'number') {
          metadata.age_display = formatTokenAge(metadata.project_age_days);
        }
        if (metadata && !metadata.age_display_short && typeof metadata.project_age_days === 'number') {
          metadata.age_display_short = formatTokenAgeShort(metadata.project_age_days);
        }

        this.logger.log(`Single token scan served from cache for: ${scanRequest.contractAddress}`);
        return {
          tier,
          risk_score: riskScore,
          risk_level: riskLevel,
          eligible,
          summary,
          metadata,
        } as any;
      }

      const result = await this.scanService.scanToken(scanRequest.contractAddress, userId, chain);
      this.logger.log(`Single token scan completed for: ${scanRequest.contractAddress}`);
      // If chain unsupported, normalize to ScanResultDto shape with eligible=false
      if ((result as any)?.metadata?.supported === false) {
        return {
          tier: null as any,
          risk_score: null as any,
          risk_level: null as any,
          eligible: false,
          summary: result.summary,
          metadata: result.metadata as any,
        } as any;
      }
      return result as any;
    } catch (error) {
      this.logger.error(`Single token scan failed for ${scanRequest.contractAddress}:`, error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Scan failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('scan-batch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Scan multiple tokens', description: 'Performs comprehensive analysis of multiple Solana tokens in batch' })
  @ApiBody({ type: BatchScanRequestDto })
  @ApiResponse({ status: 200, description: 'Batch scan completed successfully', type: BatchScanResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error during batch scan' })
  async scanBatchTokens(@Body() batchRequest: BatchScanRequestDto): Promise<BatchScanResponseDto> {
    try {
      this.logger.log(`Batch scan requested for ${batchRequest.contractAddresses.length} tokens`);
      const result = await this.scanService.scanBatchTokens(batchRequest.contractAddresses);
      this.logger.log(`Batch scan completed for ${batchRequest.contractAddresses.length} tokens`);
      return result;
    } catch (error) {
      this.logger.error(`Batch scan failed:`, error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Batch scan failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
