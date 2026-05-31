import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ApproveListingDto, RejectListingDto, UpdateUserRoleDto, ApproveMarketplaceAdDto, RejectMarketplaceAdDto, AdminEscrowActionDto, AdminEscrowExtendDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get dashboard statistics',
    description: 'Get admin dashboard statistics including total listings, pending approvals, payments, etc. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Dashboard stats retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalListings: { type: 'number' },
        pendingListings: { type: 'number' },
        publishedListings: { type: 'number' },
        totalPayments: { type: 'number' },
        totalUsers: { type: 'number' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('listings/pending')
  @ApiOperation({ summary: 'Get all pending listings for approval (admin only)' })
  @ApiResponse({ status: 200, description: 'Pending listings retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getPendingListings() {
    return this.adminService.getPendingListings();
  }

  @Get('listings/published')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get all published listings',
    description: 'Get all user listings with status PUBLISHED. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Published listings retrieved successfully',
    schema: {
      type: 'array',
      items: { type: 'object' }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getPublishedListings() {
    return this.adminService.getPublishedListings();
  }

  @Get('listings/rejected')
  @ApiOperation({ 
    summary: 'Get all rejected listings',
    description: 'Get all user listings with status REJECTED. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Rejected listings retrieved successfully',
    schema: {
      type: 'array',
      items: { type: 'object' }
    }
  })
  async getRejectedListings() {
    return this.adminService.getRejectedListings();
  }

  @Get('users')
  @ApiOperation({ summary: 'Get users list (admin only)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or email' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default 0)' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async getUsers(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.adminService.getUsers(search, limit, offset);
  }

  @Post('listings/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Approve a listing',
    description: 'Approve a user listing. Changes status from PENDING_APPROVAL to PUBLISHED. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Listing approved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        listing: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'PUBLISHED' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request or listing not in PENDING_APPROVAL status' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async approveListing(@Body() dto: ApproveListingDto) {
    return this.adminService.approveListing(dto);
  }

  @Post('listings/reject')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Reject a listing',
    description: 'Reject a user listing. Changes status from PENDING_APPROVAL to REJECTED. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Listing rejected successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        listing: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'REJECTED' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request or listing not in PENDING_APPROVAL status' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  @ApiResponse({ status: 404, description: 'Listing not found' })
  async rejectListing(@Body() dto: RejectListingDto) {
    return this.adminService.rejectListing(dto);
  }

  @Get('marketplace-ads/pending')
  @ApiOperation({ summary: 'Get pending marketplace ads for approval (admin only)' })
  @ApiResponse({ status: 200, description: 'Pending marketplace ads retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getPendingMarketplaceAds() {
    return this.adminService.getPendingMarketplaceAds();
  }

  @Get('marketplace-ads/published')
  @ApiOperation({ summary: 'Get published marketplace ads (admin only)' })
  @ApiResponse({ status: 200, description: 'Published marketplace ads retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getPublishedMarketplaceAds() {
    return this.adminService.getPublishedMarketplaceAds();
  }

  @Get('marketplace-ads/rejected')
  @ApiOperation({ summary: 'Get rejected marketplace ads (admin only)' })
  @ApiResponse({ status: 200, description: 'Rejected marketplace ads retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getRejectedMarketplaceAds() {
    return this.adminService.getRejectedMarketplaceAds();
  }

  @Post('marketplace-ads/approve')
  @ApiOperation({ summary: 'Approve a marketplace ad (admin only)' })
  @ApiResponse({ status: 200, description: 'Marketplace ad approved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async approveMarketplaceAd(@Body() dto: ApproveMarketplaceAdDto) {
    return this.adminService.approveMarketplaceAd(dto);
  }

  @Post('marketplace-ads/reject')
  @ApiOperation({ summary: 'Reject a marketplace ad (admin only)' })
  @ApiResponse({ status: 200, description: 'Marketplace ad rejected successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async rejectMarketplaceAd(@Body() dto: RejectMarketplaceAdDto) {
    return this.adminService.rejectMarketplaceAd(dto);
  }

  @Get('creator-payouts')
  @ApiOperation({ summary: 'Get creator payout requests (admin only)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by payout status' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (default 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default 0)' })
  async getCreatorPayouts(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.getCreatorPayouts(status, limit, offset);
  }

  @Post('creator-payouts/approve')
  @ApiOperation({ summary: 'Approve a creator payout request (admin only)' })
  async approveCreatorPayout(
    @Body() body: { payoutId: string; adminUserId: string; note?: string },
  ) {
    return this.adminService.approveCreatorPayout(body);
  }

  @Post('creator-payouts/reject')
  @ApiOperation({ summary: 'Reject a creator payout request (admin only)' })
  async rejectCreatorPayout(
    @Body() body: { payoutId: string; adminUserId: string; reason: string },
  ) {
    return this.adminService.rejectCreatorPayout(body);
  }

  @Post('creator-payouts/paid')
  @ApiOperation({ summary: 'Mark a creator payout as paid (admin only)' })
  async markCreatorPayoutPaid(
    @Body() body: { payoutId: string; adminUserId: string; txHash: string; note?: string },
  ) {
    return this.adminService.markCreatorPayoutPaid(body);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Get all payments (admin only)' })
  @ApiResponse({ status: 200, description: 'Payments retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getAllPayments(
    @Query('paymentType') paymentType?: string,
    @Query('status') status?: string
  ) {
    return this.adminService.getAllPayments(paymentType, status);
  }

  @Get('ad-boosts/active')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get all active ad boosts',
    description: 'Get all currently active ad boosts. Admin only.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Active ad boosts retrieved successfully',
    schema: {
      type: 'array',
      items: { type: 'object' }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getActiveAdBoosts() {
    return this.adminService.getActiveAdBoosts();
  }

  @Get('escrows')
  @ApiOperation({ summary: 'Get all escrows (admin only)' })
  async getEscrows(@Query('status') status?: string) {
    return this.adminService.getEscrows(status);
  }

  @Post('escrows/release')
  @ApiOperation({ summary: 'Force release escrow funds (admin only)' })
  async forceReleaseEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.forceReleaseEscrow(dto);
  }

  @Post('escrows/refund')
  @ApiOperation({ summary: 'Force refund escrow (admin only)' })
  async forceRefundEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.forceRefundEscrow(dto);
  }

  @Post('escrows/extend')
  @ApiOperation({ summary: 'Extend escrow deadline (admin only)' })
  async extendEscrow(@Body() dto: AdminEscrowExtendDto) {
    return this.adminService.extendEscrow(dto);
  }

  @Post('escrows/freeze')
  @ApiOperation({ summary: 'Freeze escrow (admin only)' })
  async freezeEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.freezeEscrow(dto);
  }

  @Post('escrows/unfreeze')
  @ApiOperation({ summary: 'Unfreeze escrow (admin only)' })
  async unfreezeEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.unfreezeEscrow(dto);
  }

  @Post('escrows/flag')
  @ApiOperation({ summary: 'Flag escrow (admin only)' })
  async flagEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.flagEscrow(dto);
  }

  @Post('escrows/resolve-dispute')
  @ApiOperation({ summary: 'Resolve escrow dispute (admin only)' })
  async resolveEscrow(@Body() dto: AdminEscrowActionDto) {
    return this.adminService.resolveDispute(dto);
  }

  @Post('users/update-role')
  @ApiOperation({ summary: 'Update user role (admin only)' })
  @ApiResponse({ status: 200, description: 'User role updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async updateUserRole(@Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(dto.userId, dto.role as 'USER' | 'ADMIN' | 'MODERATOR', dto.adminUserId);
  }
}

