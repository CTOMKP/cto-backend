import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveListingDto, RejectListingDto } from './dto/admin.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  // Verify admin permissions
  private async verifyAdmin(adminUserId: string) {
    const adminUser = await this.prisma.user.findUnique({ 
      where: { email: adminUserId }
    });

    if (!adminUser) {
      throw new BadRequestException('Admin user not found');
    }

    if (adminUser.role !== 'ADMIN' && adminUser.role !== 'MODERATOR') {
      throw new UnauthorizedException('Only admins and moderators can perform this action');
    }

    return adminUser;
  }

  // Get pending listings for approval
  async getPendingListings() {
    try {
      const pendingListings = await this.prisma.userListing.findMany({
        where: {
          status: 'PENDING_APPROVAL' // Only show paid listings awaiting approval
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              createdAt: true
            }
          },
          boosts: {
            where: {
              endDate: {
                gte: new Date() // Only active boosts
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return {
        success: true,
        listings: pendingListings,
        total: pendingListings.length,
        message: 'Pending listings retrieved successfully'
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get pending listings:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get pending listings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get published listings
  async getPublishedListings() {
    try {
      const publishedListings = await this.prisma.userListing.findMany({
        where: {
          status: 'PUBLISHED'
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          boosts: {
            where: {
              endDate: {
                gte: new Date()
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return {
        success: true,
        listings: publishedListings,
        total: publishedListings.length,
        message: 'Published listings retrieved successfully'
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get published listings:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get published listings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get rejected listings
  async getRejectedListings() {
    try {
      const rejectedListings = await this.prisma.userListing.findMany({
        where: {
          status: 'REJECTED'
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          boosts: {
            where: {
              endDate: {
                gte: new Date()
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return {
        success: true,
        listings: rejectedListings,
        total: rejectedListings.length,
        message: 'Rejected listings retrieved successfully'
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get rejected listings:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get rejected listings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get users (admin view)
  async getUsers(search?: string, limit?: string, offset?: string) {
    try {
      const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const skip = Math.max(Number(offset) || 0, 0);
      const query = (search || '').trim();

      const where: Prisma.UserWhereInput | undefined = query
        ? {
            OR: [
              { email: { contains: query, mode: Prisma.QueryMode.insensitive } },
              { name: { contains: query, mode: Prisma.QueryMode.insensitive } },
              { privyDid: { contains: query, mode: Prisma.QueryMode.insensitive } }
            ]
          }
        : undefined;

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            privyDid: true,
            lastLoginAt: true,
            createdAt: true,
            wallets: {
              select: {
                id: true,
                address: true,
                blockchain: true,
                walletClient: true,
                isPrimary: true,
                createdAt: true,
                walletBalances: {
                  select: {
                    tokenAddress: true,
                    tokenSymbol: true,
                    tokenName: true,
                    decimals: true,
                    balance: true,
                    balanceUsd: true,
                    lastUpdated: true
                  }
                },
                walletTransactions: {
                  select: {
                    txHash: true,
                    txType: true,
                    amount: true,
                    tokenSymbol: true,
                    fromAddress: true,
                    toAddress: true,
                    status: true,
                    createdAt: true
                  },
                  orderBy: {
                    createdAt: 'desc'
                  },
                  take: 5
                }
              }
            },
            _count: {
              select: {
                wallets: true,
                userListings: true,
                payments: true,
                scanResults: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          skip,
          take
        }),
        this.prisma.user.count({ where })
      ]);

      return {
        success: true,
        users,
        total,
        limit: take,
        offset: skip,
        message: 'Users retrieved successfully'
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get users:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get users: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Approve listing
  async approveListing(dto: ApproveListingDto) {
    try {
      // Verify admin
      await this.verifyAdmin(dto.adminUserId);

      const listing = await this.prisma.userListing.findUnique({
        where: { id: dto.listingId }
      });

      if (!listing) {
        throw new BadRequestException('Listing not found');
      }

      if (listing.status === 'PUBLISHED') {
        throw new BadRequestException('Listing is already published');
      }

      // Update listing status to published
      const updatedListing = await this.prisma.userListing.update({
        where: { id: dto.listingId },
        data: {
          status: 'PUBLISHED',
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              email: true,
              name: true
            }
          }
        }
      });

      this.logger.log(`Listing ${dto.listingId} approved by admin ${dto.adminUserId}`);

      return {
        success: true,
        listing: updatedListing,
        message: 'Listing approved and published successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to approve listing:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to approve listing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Reject listing
  async rejectListing(dto: RejectListingDto) {
    try {
      // Verify admin
      await this.verifyAdmin(dto.adminUserId);

      const listing = await this.prisma.userListing.findUnique({
        where: { id: dto.listingId }
      });

      if (!listing) {
        throw new BadRequestException('Listing not found');
      }

      if (listing.status === 'REJECTED') {
        throw new BadRequestException('Listing is already rejected');
      }

      // Update listing status to rejected
      const updatedListing = await this.prisma.userListing.update({
        where: { id: dto.listingId },
        data: {
          status: 'REJECTED',
          description: `${listing.description}\n\n---\nRejection Reason: ${dto.reason}\nNotes: ${dto.notes || 'N/A'}`,
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              email: true,
              name: true
            }
          }
        }
      });

      this.logger.log(`Listing ${dto.listingId} rejected by admin ${dto.adminUserId}. Reason: ${dto.reason}`);

      return {
        success: true,
        listing: updatedListing,
        message: 'Listing rejected successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to reject listing:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to reject listing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get all payments (admin view)
  async getAllPayments(paymentType?: string, status?: string) {
    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          ...(paymentType && { paymentType: paymentType as 'LISTING' | 'AD_BOOST' | 'ESCROW' | 'WITHDRAWAL' | 'OTHER' }),
          ...(status && { status: status as 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED' })
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 100 // Limit to last 100 payments
      });

      const listingIds = Array.from(
        new Set(payments.map((payment) => payment.listingId).filter((id): id is string => Boolean(id)))
      );
      const listings = listingIds.length
        ? await this.prisma.userListing.findMany({
            where: { id: { in: listingIds } },
            select: { id: true, title: true }
          })
        : [];
      const listingsById = new Map(listings.map((listing) => [listing.id, listing]));
      const paymentsWithListings = payments.map((payment) => ({
        ...payment,
        listing: payment.listingId ? listingsById.get(payment.listingId) || null : null
      }));

      const totalAmount = payments
        .filter(p => p.status === 'COMPLETED')
        .reduce((sum, p) => sum + p.amount, 0);

      return {
        success: true,
        payments: paymentsWithListings,
        total: payments.length,
        totalAmount: totalAmount,
        currency: 'USDC',
        message: 'Payments retrieved successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to get payments:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get payments: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get active ad boosts
  async getActiveAdBoosts() {
    try {
      const activeBoosts = await this.prisma.adBoost.findMany({
        where: {
          endDate: {
            gte: new Date()
          }
        },
        include: {
          listing: {
            include: {
              user: {
                select: {
                  email: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          startDate: 'desc'
        }
      });

      return {
        success: true,
        boosts: activeBoosts,
        total: activeBoosts.length,
        message: 'Active ad boosts retrieved successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to get active ad boosts:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get active ad boosts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get dashboard statistics
  async getDashboardStats() {
    try {
      const [
        totalUsers,
        totalListings,
        pendingListings,
        publishedListings,
        rejectedListings,
        totalPayments,
        completedPayments,
        pendingPayments,
        activeBoosts,
        totalRevenue
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.userListing.count(),
        this.prisma.userListing.count({ where: { status: 'DRAFT' } }),
        this.prisma.userListing.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.userListing.count({ where: { status: 'REJECTED' } }),
        this.prisma.payment.count(),
        this.prisma.payment.count({ where: { status: 'COMPLETED' } }),
        this.prisma.payment.count({ where: { status: 'PENDING' } }),
        this.prisma.adBoost.count({
          where: { endDate: { gte: new Date() } }
        }),
        this.prisma.payment.aggregate({
          where: { status: 'COMPLETED' },
          _sum: { amount: true }
        })
      ]);

      return {
        success: true,
        stats: {
          users: {
            total: totalUsers
          },
          listings: {
            total: totalListings,
            pending: pendingListings,
            published: publishedListings,
            rejected: rejectedListings
          },
          payments: {
            total: totalPayments,
            completed: completedPayments,
            pending: pendingPayments,
            revenue: totalRevenue._sum.amount || 0,
            currency: 'USDC'
          },
          adBoosts: {
            active: activeBoosts
          }
        },
        message: 'Dashboard statistics retrieved successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to get dashboard stats:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get dashboard stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Update user role
  async updateUserRole(userId: string, role: 'USER' | 'ADMIN' | 'MODERATOR', adminUserId: string) {
    try {
      // Verify admin
      await this.verifyAdmin(adminUserId);

      const user = await this.prisma.user.findUnique({
        where: { email: userId }
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const updatedUser = await this.prisma.user.update({
        where: { email: userId },
        data: { role }
      });

      this.logger.log(`User ${userId} role updated to ${role} by admin ${adminUserId}`);

      return {
        success: true,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role
        },
        message: `User role updated to ${role} successfully`
      };

    } catch (error: unknown) {
      this.logger.error('Failed to update user role:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to update user role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

