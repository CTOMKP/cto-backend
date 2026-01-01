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
  @ApiQuery({ name: 'minLpBurned', required: false, type: Number, description: 'Filter by LP burned percentage (e.g., 50 for >=50%)' })
  @ApiQuery({ name: 'maxTop10Holders', required: false, type: Number, description: 'Filter by top 10 holders percentage (e.g., 15 for <15%)' })
  @ApiQuery({ name: 'mintAuthDisabled', required: false, type: Boolean, description: 'Filter by mint authority disabled' })
  @ApiQuery({ name: 'noRaiding', required: false, type: Boolean, description: 'Filter by raiding detection (true = no raiding detected)' })
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

  @Get('holders/:contractAddress')
  @ApiOperation({ summary: 'Get holder count for a token with multi-API fallback' })
  @ApiQuery({ name: 'chain', required: false, description: 'Blockchain (ETHEREUM, SOLANA, BSC, etc.)' })
  @ApiResponse({ status: 200, description: 'Holder count returned' })
  async getHolders(
    @Param('contractAddress') contractAddress: string,
    @Query('chain') chain?: string,
  ) {
    return this.listingService.getHolders(contractAddress, chain || 'SOLANA');
  }

  @Get('transfers/:contractAddress')
  @ApiOperation({ summary: 'Get transfer analytics for a token via Bitquery' })
  @ApiQuery({ name: 'chain', required: false, description: 'Blockchain (ETHEREUM, SOLANA, BSC, etc.)' })
  @ApiResponse({ status: 200, description: 'Transfer analytics returned' })
  async getTransfers(
    @Param('contractAddress') contractAddress: string,
    @Query('chain') chain?: string,
  ) {
    return this.listingService.getTransfers(contractAddress, chain || 'SOLANA');
  }

  @Get('chart/:contractAddress')
  @ApiOperation({ summary: 'Get OHLCV chart data for a token' })
  @ApiQuery({ name: 'chain', required: false, description: 'Blockchain' })
  @ApiQuery({ name: 'timeframe', required: false, description: 'Timeframe (1h, 4h, 1d)' })
  @ApiResponse({ status: 200, description: 'Chart data returned' })
  async getChartData(
    @Param('contractAddress') contractAddress: string,
    @Query('chain') chain?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.listingService.getChartData(contractAddress, chain || 'SOLANA', timeframe || '1h');
  }

  @Post('refresh-holders')
  @ApiOperation({ summary: 'Refresh holder data for all tokens' })
  @ApiResponse({ status: 200, description: 'Holder data refresh initiated' })
  async refreshHolders() {
    return this.listingService.refreshHolders();
  }

  @Post('fetch-feed')
  @ApiOperation({ summary: 'Manually trigger the public feed fetch (Admin/Dev only)' })
  @ApiResponse({ status: 200, description: 'Feed fetch triggered' })
  async fetchFeed() {
    return this.listingService.fetchFeed();
  }

  @Post('ensure-pinned')
  @ApiOperation({ summary: 'Force injection of pinned community tokens' })
  @ApiResponse({ status: 200, description: 'Pinned token sync triggered' })
  async ensurePinned() {
    return this.listingService.ensurePinned();
  }

}