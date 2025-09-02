import { 
  Controller, 
  Post, 
  Body, 
  HttpException, 
  HttpStatus,
  Logger 
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiBody
} from '@nestjs/swagger';
import { ScanService } from './services/scan.service';
import { ScanRequestDto, BatchScanRequestDto } from './dto/scan-request.dto';
import { ScanResultDto, BatchScanResponseDto } from './dto/scan-response.dto';

@ApiTags('Token Scanning')
@Controller('scan')
export class ScanController {
  private readonly logger = new Logger(ScanController.name);

  constructor(private readonly scanService: ScanService) {}

  @Post('scan')
  @ApiOperation({
    summary: 'Scan a single token',
    description: 'Performs comprehensive analysis of a single Solana token'
  })
  @ApiBody({ type: ScanRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Token scan completed successfully',
    type: ScanResultDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters'
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during scan'
  })
  async scanSingleToken(@Body() scanRequest: ScanRequestDto): Promise<ScanResultDto> {
    try {
      this.logger.log(`Single token scan requested for: ${scanRequest.contractAddress}`);
      
      const result = await this.scanService.scanToken(scanRequest.contractAddress);
      
      this.logger.log(`Single token scan completed for: ${scanRequest.contractAddress}`);
      return result;
    } catch (error) {
      this.logger.error(`Single token scan failed for ${scanRequest.contractAddress}:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Scan failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('scan-batch')
  @ApiOperation({
    summary: 'Scan multiple tokens',
    description: 'Performs comprehensive analysis of multiple Solana tokens in batch'
  })
  @ApiBody({ type: BatchScanRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Batch scan completed successfully',
    type: BatchScanResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters'
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during batch scan'
  })
  async scanBatchTokens(@Body() batchRequest: BatchScanRequestDto): Promise<BatchScanResponseDto> {
    try {
      this.logger.log(`Batch scan requested for ${batchRequest.contractAddresses.length} tokens`);
      
      const result = await this.scanService.scanBatchTokens(batchRequest.contractAddresses);
      
      this.logger.log(`Batch scan completed for ${batchRequest.contractAddresses.length} tokens`);
      return result;
    } catch (error) {
      this.logger.error(`Batch scan failed:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Batch scan failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
