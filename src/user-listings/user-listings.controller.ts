import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'List published user listings (paginated)' })
  async listPublic(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.svc.findPublic(Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single published user listing' })
  async getOnePublic(@Param('id') id: string) {
    return this.svc.findOnePublic(id);
  }

  // Authenticated endpoints
  @Post('scan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Scan contract and return vetting result' })
  async scan(@Body() dto: ScanDto, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.scan(Number(userId), dto);
  }

  @Get('mine/all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get current user's listings" })
  async mine(@Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.findMine(Number(userId));
  }

  @Get('mine/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get one of current user's listings (including DRAFT)" })
  async getMyListing(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    return this.svc.findMyListing(Number(userId), id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create draft user listing (requires passing vetting)' })
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
  @ApiOperation({ summary: 'Publish a user listing' })
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