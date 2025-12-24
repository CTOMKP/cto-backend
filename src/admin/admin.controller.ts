import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ApproveListingDto, RejectListingDto, UpdateUserRoleDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('admin')
@Controller('admin')
// @UseGuards(JwtAuthGuard, AdminGuard) // Uncomment when implementing auth guards
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

  @Post('users/update-role')
  @ApiOperation({ summary: 'Update user role (admin only)' })
  @ApiResponse({ status: 200, description: 'User role updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  async updateUserRole(@Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(dto.userId, dto.role as 'USER' | 'ADMIN' | 'MODERATOR', dto.adminUserId);
  }
}

