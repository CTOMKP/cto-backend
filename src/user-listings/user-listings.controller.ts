import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserListingsService } from './user-listings.service';
import { ScanDto } from './dto/scan.dto';
import { CreateUserListingDto } from './dto/create-user-listing.dto';
import { UpdateUserListingDto } from './dto/update-user-listing.dto';
import { CreateAdBoostDto } from './dto/ad-boost.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('UserListings')
@Controller('user-listings')
export class UserListingsController {
  constructor(private readonly svc: UserListingsService) {}

  // Public endpoints
  @Get()
  @ApiOperation({ 
    summary: 'List published user listings (paginated)',
    description: 'Get paginated list of published user listings. Only returns listings with status PUBLISHED.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Listings retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 20 },
        total: { type: 'number', example: 100 },
        items: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  async listPublic(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.svc.findPublic(Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get a single published user listing',
    description: 'Get details of a published user listing by ID. Only returns listings with status PUBLISHED.'
  })
  @ApiResponse({ status: 200, description: 'Listing retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Listing not found or not published' })
  async getOnePublic(@Param('id') id: string) {
    return this.svc.findOnePublic(id);
  }

  // Authenticated endpoints
  @Post('scan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Scan contract and return vetting result',
    description: 'Scans a token contract address using Pillar 1 logic and returns risk score and tier. Note: Returns duplicate fields (risk_score/vettingScore and tier/vettingTier) for frontend compatibility.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Scan successful',
    schema: {
      type: 'object',
      properties: {
        risk_score: { type: 'number', example: 75 },
        vettingScore: { type: 'number', example: 75 },
        tier: { type: 'string', example: 'bloom' },
        vettingTier: { type: 'string', example: 'bloom' },
        eligible: { type: 'boolean', example: true }
      }
    }
  })
  async scan(@Body() dto: ScanDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.scan(Number(userId), dto);
  }

  @Get('mine/all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get current user's listings" })
  @ApiResponse({
    status: 200,
    description: 'Listings retrieved successfully (includes scanMetadata when available).',
  })
  async mine(@Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.findMine(Number(userId));
  }

  @Get('mine/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get one of current user's listings (including DRAFT)" })
  @ApiResponse({
    status: 200,
    description: 'Listing retrieved successfully (includes scanMetadata when available).',
  })
  async getMyListing(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.findMyListing(Number(userId), id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Create draft user listing',
    description: 'Create a new user listing with DRAFT status. Requires token to have passed vetting (risk_score >= 50). Payment is required later to publish.'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Listing created successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'cmhx1234567890' },
        status: { type: 'string', example: 'DRAFT' },
        title: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid input or token did not pass vetting' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Body() dto: CreateUserListingDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.create(Number(userId), dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update draft user listing' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserListingDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.update(Number(userId), id, dto);
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Publish a user listing',
    description: 'Publish a user listing. Requires payment to be completed first. If no payment exists, listing remains DRAFT and user must pay before publishing.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Listing published successfully (if payment exists)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', example: 'PENDING_APPROVAL' },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Payment required or listing cannot be published' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async publish(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.publish(Number(userId), id);
  }

  @Post(':id/ads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Purchase an ad package (stub payment)' })
  async addAd(@Param('id') id: string, @Body() dto: CreateAdBoostDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.addAdBoost(Number(userId), id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a user listing (only DRAFT listings can be deleted)' })
  async delete(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.deleteListing(Number(userId), id);
  }
}
