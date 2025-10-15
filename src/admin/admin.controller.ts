import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ApproveListingDto, RejectListingDto, UpdateUserRoleDto } from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin')
// @UseGuards(JwtAuthGuard, AdminGuard) // Uncomment when implementing auth guards
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Get dashboard statistics (admin only)' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved successfully' })
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
  @ApiOperation({ summary: 'Get all published listings (admin only)' })
  @ApiResponse({ status: 200, description: 'Published listings retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getPublishedListings() {
    return this.adminService.getPublishedListings();
  }

  @Post('listings/approve')
  @ApiOperation({ summary: 'Approve a listing (admin only)' })
  @ApiResponse({ status: 200, description: 'Listing approved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async approveListing(@Body() dto: ApproveListingDto) {
    return this.adminService.approveListing(dto);
  }

  @Post('listings/reject')
  @ApiOperation({ summary: 'Reject a listing (admin only)' })
  @ApiResponse({ status: 200, description: 'Listing rejected successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async rejectListing(@Body() dto: RejectListingDto) {
    return this.adminService.rejectListing(dto);
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
  @ApiOperation({ summary: 'Get all active ad boosts (admin only)' })
  @ApiResponse({ status: 200, description: 'Active ad boosts retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async getActiveAdBoosts() {
    return this.adminService.getActiveAdBoosts();
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

