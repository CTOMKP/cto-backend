/*
  ListingController
  -----------------
  Endpoints:
   - GET /api/listing/listings
   - GET /api/listing/:contractAddress
   - POST /api/listing/scan
   - POST /api/listing/refresh
*/
import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ListingService } from './listing.service';
import { ListingQueryDto } from './dto/listing-query.dto';
import { ListingScanRequestDto } from './dto/scan-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RateLimiterGuard } from './services/rate-limiter.guard';

@ApiTags('Listing')
@Controller('listing')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Get('listings')
  @ApiOperation({ summary: 'List listings (paginated)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'chain', required: false, description: 'Filter by chain (SOLANA, EVM, BASE, NEAR, OSMOSIS, OTHER, UNKNOWN)' })
  @ApiQuery({ name: 'category', required: false, description: 'Filter by category (MEME, DEFI, NFT, OTHER, UNKNOWN)' })
  @ApiQuery({ name: 'tier', required: false })
  @ApiQuery({ name: 'minRisk', required: false, type: Number })
  @ApiQuery({ name: 'maxRisk', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, example: 'updatedAt:desc' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Listings returned successfully' })
  async list(@Query() query: ListingQueryDto) {
    return this.listingService.listListings(query);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics for listing pipeline' })
  @ApiResponse({ status: 200, description: 'Prometheus metrics text' })
  async metrics() {
    return this.listingService.metrics();
  }

  @Get(':contractAddress')
  @ApiOperation({ summary: 'Get a single listing by contract address' })
  @ApiResponse({ status: 200, description: 'Listing returned successfully' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getOne(@Param('contractAddress') contractAddress: string) {
    return this.listingService.getListing(contractAddress);
  }

  @Post('scan')
  @UseGuards(RateLimiterGuard)
  @HttpCode(200)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Scan a token and upsert listing' })
  @ApiResponse({ status: 200, description: 'Scan completed and listing updated' })
  async scan(@Body() dto: ListingScanRequestDto) {
    return this.listingService.scan(dto.contractAddress, dto.chain as any);
  }

  @Post('refresh')
  @HttpCode(202)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Trigger background refresh for a contract' })
  @ApiBody({ type: RefreshRequestDto })
  @ApiResponse({ status: 202, description: 'Refresh accepted' })
  async refresh(@Body() dto: RefreshRequestDto) {
    if (!dto || !dto.contractAddress) {
      const { BadRequestException } = await import('@nestjs/common');
      throw new BadRequestException('contractAddress is required');
    }
    const chain = (dto as any)?.chain ?? 'SOLANA';
    return this.listingService.refresh(dto.contractAddress, chain as any);
  }

}