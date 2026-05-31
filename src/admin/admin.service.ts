import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveListingDto, RejectListingDto, ApproveMarketplaceAdDto, RejectMarketplaceAdDto, AdminEscrowActionDto, AdminEscrowExtendDto } from './dto/admin.dto';
import { CreatorPayoutStatus, Prisma } from '@prisma/client';
import { EscrowService } from '../escrow/escrow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { XpService } from '../xp/xp.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private escrowService: EscrowService,
    private notifications: NotificationsService,
    private xpService: XpService,
    private emailService: EmailService,
  ) {}

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

      await this.notifications.createNotification({
        userId: updatedListing.userId,
        type: 'LISTING_APPROVAL',
        title: 'Your listing is now live',
        body: `${updatedListing.title} was approved and published. Click to view.`,
        data: {
          listingId: updatedListing.id,
          contractAddr: updatedListing.contractAddr,
          action: 'VIEW_LISTING_LIVE',
          redirectPath: `/user-listings/${updatedListing.id}/live`,
        },
      });

      if (updatedListing.user?.email) {
        await this.emailService.sendListingApprovedEmail({
          to: updatedListing.user.email,
          userName: updatedListing.user.name,
          listingId: updatedListing.id,
          projectTitle: updatedListing.title,
        });
      }

      await this.xpService.awardApprovedListing(updatedListing.userId, updatedListing.id);

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

      await this.notifications.createNotification({
        userId: updatedListing.userId,
        type: 'LISTING_APPROVAL',
        title: 'Listing rejected',
        body: `${updatedListing.title} was rejected. Click to view feedback.`,
        data: {
          listingId: updatedListing.id,
          reason: dto.reason,
          action: 'VIEW_REJECTED_LISTING',
          redirectPath: `/user-listings/${updatedListing.id}`,
          status: 'REJECTED',
        },
      });

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

  async getPendingMarketplaceAds() {
    try {
      const pendingAds = await this.prisma.marketplaceAd.findMany({
        where: { status: 'PENDING_APPROVAL' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        ads: pendingAds,
        total: pendingAds.length,
        message: 'Pending marketplace ads retrieved successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get pending marketplace ads:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get pending marketplace ads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getPublishedMarketplaceAds() {
    try {
      const publishedAds = await this.prisma.marketplaceAd.findMany({
        where: { status: 'PUBLISHED' },
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        ads: publishedAds,
        total: publishedAds.length,
        message: 'Published marketplace ads retrieved successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get published marketplace ads:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get published marketplace ads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getRejectedMarketplaceAds() {
    try {
      const rejectedAds = await this.prisma.marketplaceAd.findMany({
        where: { status: 'REJECTED' },
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        ads: rejectedAds,
        total: rejectedAds.length,
        message: 'Rejected marketplace ads retrieved successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get rejected marketplace ads:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get rejected marketplace ads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async approveMarketplaceAd(dto: ApproveMarketplaceAdDto) {
    try {
      await this.verifyAdmin(dto.adminUserId);

      const ad = await this.prisma.marketplaceAd.findUnique({
        where: { id: dto.adId },
      });

      if (!ad) throw new BadRequestException('Marketplace ad not found');
      if (ad.status === 'PUBLISHED') throw new BadRequestException('Marketplace ad is already published');

      const publishedAt = new Date();
      const expiresAt = new Date(publishedAt);
      expiresAt.setDate(expiresAt.getDate() + 28);

      let featuredUntil: Date | null = null;
      if (ad.tier === 'PLUS') {
        featuredUntil = new Date(publishedAt);
        featuredUntil.setDate(featuredUntil.getDate() + 1);
      }
      if (ad.tier === 'PREMIUM') {
        featuredUntil = new Date(publishedAt);
        featuredUntil.setDate(featuredUntil.getDate() + 7);
      }
      if (ad.topOfDayDays && ad.topOfDayDays > 0) {
        const topUntil = new Date(publishedAt);
        topUntil.setDate(topUntil.getDate() + ad.topOfDayDays);
        if (!featuredUntil || topUntil > featuredUntil) {
          featuredUntil = topUntil;
        }
      }

      const updated = await this.prisma.marketplaceAd.update({
        where: { id: dto.adId },
        data: {
          status: 'PUBLISHED',
          publishedAt,
          expiresAt,
          featuredUntil,
          approvedBy: (await this.prisma.user.findUnique({ where: { email: dto.adminUserId } }))?.id ?? null,
          updatedAt: new Date(),
        },
        include: {
          user: { select: { email: true, name: true } },
        },
      });

      this.logger.log(`Marketplace ad ${dto.adId} approved by admin ${dto.adminUserId}`);

      await this.notifications.createNotification({
        userId: updated.userId,
        type: 'AD_APPROVAL',
        title: 'Marketplace ad approved',
        body: updated.title,
        data: { adId: updated.id },
      });

      if (updated.user?.email) {
        await this.emailService.sendMarketplaceAdApprovedEmail({
          to: updated.user.email,
          userName: updated.user.name,
          adId: updated.id,
          adTitle: updated.title,
        });
      }

      await this.xpService.awardApprovedAd(updated.userId, updated.id);

      return {
        success: true,
        ad: updated,
        message: 'Marketplace ad approved and published successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to approve marketplace ad:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to approve marketplace ad: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async rejectMarketplaceAd(dto: RejectMarketplaceAdDto) {
    try {
      await this.verifyAdmin(dto.adminUserId);

      const ad = await this.prisma.marketplaceAd.findUnique({
        where: { id: dto.adId },
      });

      if (!ad) throw new BadRequestException('Marketplace ad not found');
      if (ad.status === 'REJECTED') throw new BadRequestException('Marketplace ad is already rejected');

      const updated = await this.prisma.marketplaceAd.update({
        where: { id: dto.adId },
        data: {
          status: 'REJECTED',
          rejectionReason: `${dto.reason}${dto.notes ? `\nNotes: ${dto.notes}` : ''}`,
          updatedAt: new Date(),
        },
        include: {
          user: { select: { email: true, name: true } },
        },
      });

      this.logger.log(`Marketplace ad ${dto.adId} rejected by admin ${dto.adminUserId}. Reason: ${dto.reason}`);

      await this.notifications.createNotification({
        userId: updated.userId,
        type: 'AD_APPROVAL',
        title: 'Marketplace ad rejected',
        body: updated.title,
        data: { adId: updated.id, reason: dto.reason },
      });

      return {
        success: true,
        ad: updated,
        message: 'Marketplace ad rejected successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to reject marketplace ad:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to reject marketplace ad: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getCreatorPayouts(status?: string, limit?: string, offset?: string) {
    try {
      const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const skip = Math.max(Number(offset) || 0, 0);
      const normalizedStatus = (status || '').trim().toUpperCase();

      const where: Prisma.CreatorPayoutWhereInput | undefined = normalizedStatus
        ? {
            status: normalizedStatus as CreatorPayoutStatus,
          }
        : undefined;

      const [payouts, total] = await Promise.all([
        this.prisma.creatorPayout.findMany({
          where,
          include: {
            creatorUser: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
              },
            },
            creatorAccount: {
              select: {
                id: true,
                referralCode: true,
                tier: true,
                pendingBalance: true,
                reservedBalance: true,
                paidBalance: true,
                payoutWalletAddress: true,
                fraudStatus: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.creatorPayout.count({ where }),
      ]);

      return {
        success: true,
        payouts,
        total,
        limit: take,
        offset: skip,
        message: 'Creator payouts retrieved successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get creator payouts:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get creator payouts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async approveCreatorPayout(dto: { payoutId: string; adminUserId: string; note?: string }) {
    try {
      const adminUser = await this.verifyAdmin(dto.adminUserId);
      const payout = await this.prisma.creatorPayout.findUnique({
        where: { id: dto.payoutId },
        include: {
          creatorUser: { select: { id: true, email: true, name: true } },
          creatorAccount: { select: { id: true, referralCode: true, pendingBalance: true, reservedBalance: true } },
        },
      });

      if (!payout) {
        throw new BadRequestException('Creator payout not found');
      }
      if (payout.status === 'REJECTED') {
        throw new BadRequestException('Rejected payouts cannot be approved');
      }
      if (payout.status === 'PAID') {
        return { success: true, payout, message: 'Creator payout is already paid' };
      }

      const updated = await this.prisma.creatorPayout.update({
        where: { id: payout.id },
        data: {
          status: 'APPROVED',
          reviewedBy: adminUser.id,
          reviewedAt: new Date(),
          failureReason: dto.note?.trim() || null,
        },
        include: {
          creatorUser: { select: { id: true, email: true, name: true } },
          creatorAccount: { select: { id: true, referralCode: true, pendingBalance: true, reservedBalance: true } },
        },
      });

      await this.notifications.createNotification({
        userId: updated.creatorUserId,
        type: 'SYSTEM',
        title: 'Creator payout approved',
        body: `Your payout request for $${updated.amountRequested.toFixed(2)} was approved.`,
        data: {
          route: '/profile',
          payoutId: updated.id,
          status: updated.status,
          amountRequested: updated.amountRequested,
          note: dto.note?.trim() || null,
        },
      });

      this.logger.log(`Creator payout ${updated.id} approved by ${adminUser.email}`);

      return {
        success: true,
        payout: updated,
        message: 'Creator payout approved successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to approve creator payout:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException(`Failed to approve creator payout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async rejectCreatorPayout(dto: { payoutId: string; adminUserId: string; reason: string }) {
    try {
      const adminUser = await this.verifyAdmin(dto.adminUserId);
      const payout = await this.prisma.creatorPayout.findUnique({
        where: { id: dto.payoutId },
        include: {
          creatorUser: { select: { id: true, email: true, name: true } },
          creatorAccount: { select: { id: true, referralCode: true, pendingBalance: true, reservedBalance: true } },
        },
      });

      if (!payout) {
        throw new BadRequestException('Creator payout not found');
      }
      if (payout.status === 'PAID') {
        throw new BadRequestException('Paid payouts cannot be rejected');
      }
      if (!dto.reason.trim()) {
        throw new BadRequestException('Rejection reason is required');
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        const payoutUpdate = await tx.creatorPayout.update({
          where: { id: payout.id },
          data: {
            status: 'REJECTED',
            reviewedBy: adminUser.id,
            reviewedAt: new Date(),
            rejectedAt: new Date(),
            failureReason: dto.reason.trim(),
          },
        });

        await tx.creatorProgramAccount.update({
          where: { id: payout.creatorAccountId },
          data: {
            reservedBalance: { decrement: payout.amountRequested },
            pendingBalance: { increment: payout.amountRequested },
          },
        });

        return payoutUpdate;
      });

      await this.notifications.createNotification({
        userId: updated.creatorUserId,
        type: 'SYSTEM',
        title: 'Creator payout rejected',
        body: `Your payout request for $${updated.amountRequested.toFixed(2)} was rejected.`,
        data: {
          route: '/profile',
          payoutId: updated.id,
          status: updated.status,
          amountRequested: updated.amountRequested,
          reason: dto.reason.trim(),
        },
      });

      this.logger.log(`Creator payout ${updated.id} rejected by ${adminUser.email}. Reason: ${dto.reason}`);

      return {
        success: true,
        payout: updated,
        message: 'Creator payout rejected successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to reject creator payout:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException(`Failed to reject creator payout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async markCreatorPayoutPaid(dto: { payoutId: string; adminUserId: string; txHash: string; note?: string }) {
    try {
      const adminUser = await this.verifyAdmin(dto.adminUserId);
      const payout = await this.prisma.creatorPayout.findUnique({
        where: { id: dto.payoutId },
        include: {
          creatorUser: { select: { id: true, email: true, name: true } },
          creatorAccount: { select: { id: true, referralCode: true, pendingBalance: true, reservedBalance: true, paidBalance: true } },
        },
      });

      if (!payout) {
        throw new BadRequestException('Creator payout not found');
      }
      if (!dto.txHash.trim()) {
        throw new BadRequestException('Transaction hash is required');
      }
      if (payout.status === 'PAID') {
        return { success: true, payout, message: 'Creator payout is already marked paid' };
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        const payoutUpdate = await tx.creatorPayout.update({
          where: { id: payout.id },
          data: {
            status: 'PAID',
            txHash: dto.txHash.trim(),
            processedAt: new Date(),
            reviewedBy: adminUser.id,
            reviewedAt: new Date(),
            failureReason: dto.note?.trim() || null,
          },
        });

        await tx.creatorProgramAccount.update({
          where: { id: payout.creatorAccountId },
          data: {
            reservedBalance: { decrement: payout.amountRequested },
            paidBalance: { increment: payout.amountRequested },
          },
        });

        return payoutUpdate;
      });

      await this.notifications.createNotification({
        userId: updated.creatorUserId,
        type: 'SYSTEM',
        title: 'Creator payout paid',
        body: `Your payout of $${updated.amountRequested.toFixed(2)} has been marked paid.`,
        data: {
          route: '/profile',
          payoutId: updated.id,
          status: updated.status,
          amountRequested: updated.amountRequested,
          txHash: updated.txHash,
        },
      });

      this.logger.log(`Creator payout ${updated.id} marked paid by ${adminUser.email}`);

      return {
        success: true,
        payout: updated,
        message: 'Creator payout marked as paid successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to mark creator payout paid:', error instanceof Error ? error.message : 'Unknown error');
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException(`Failed to mark creator payout paid: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get all payments (admin view)
  async getAllPayments(paymentType?: string, status?: string) {
    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          ...(paymentType && { paymentType: paymentType as 'LISTING' | 'AD_BOOST' | 'MARKETPLACE_AD' | 'ESCROW' | 'WITHDRAWAL' | 'OTHER' }),
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
      const marketplaceAdIds = Array.from(
        new Set(payments.map((payment) => payment.marketplaceAdId).filter((id): id is string => Boolean(id)))
      );

      const [listings, marketplaceAds] = await Promise.all([
        listingIds.length
          ? this.prisma.userListing.findMany({
              where: { id: { in: listingIds } },
              select: { id: true, title: true }
            })
          : Promise.resolve([]),
        marketplaceAdIds.length
          ? this.prisma.marketplaceAd.findMany({
              where: { id: { in: marketplaceAdIds } },
              select: { id: true, title: true }
            })
          : Promise.resolve([])
      ]);

      const listingsById = new Map(listings.map((listing) => [listing.id, listing]));
      const marketplaceAdsById = new Map(marketplaceAds.map((ad) => [ad.id, ad]));

      const paymentsWithListings = payments.map((payment) => ({
        ...payment,
        listing: payment.listingId ? listingsById.get(payment.listingId) || null : null,
        marketplaceAd: payment.marketplaceAdId ? marketplaceAdsById.get(payment.marketplaceAdId) || null : null
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

  async getEscrows(status?: string) {
    const escrows = await this.escrowService.listForAdmin(status);
    return {
      success: true,
      escrows,
      total: escrows.length,
      message: 'Escrows retrieved successfully',
    };
  }

  async forceReleaseEscrow(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.release(0, dto.escrowId, true);
    return { success: true, escrow, message: 'Escrow released by admin' };
  }

  async forceRefundEscrow(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.refund(0, dto.escrowId, true);
    return { success: true, escrow, message: 'Escrow refunded by admin' };
  }

  async extendEscrow(dto: AdminEscrowExtendDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.extendDeadline(0, dto.escrowId, dto.newDeadline);
    return { success: true, escrow, message: 'Escrow deadline extended' };
  }

  async resolveDispute(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.unfreeze(0, dto.escrowId);
    return { success: true, escrow, message: 'Escrow dispute resolved' };
  }

  async freezeEscrow(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.freeze(0, dto.escrowId);
    return { success: true, escrow, message: 'Escrow frozen' };
  }

  async unfreezeEscrow(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.unfreeze(0, dto.escrowId);
    return { success: true, escrow, message: 'Escrow unfrozen' };
  }

  async flagEscrow(dto: AdminEscrowActionDto) {
    await this.verifyAdmin(dto.adminUserId);
    const escrow = await this.escrowService.flag(0, dto.escrowId, dto.reason || '');
    return { success: true, escrow, message: 'Escrow flagged' };
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
        totalMarketplaceAds,
        pendingMarketplaceAds,
        publishedMarketplaceAds,
        rejectedMarketplaceAds,
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
        this.prisma.marketplaceAd.count(),
        this.prisma.marketplaceAd.count({ where: { status: 'PENDING_APPROVAL' } }),
        this.prisma.marketplaceAd.count({ where: { status: 'PUBLISHED' } }),
        this.prisma.marketplaceAd.count({ where: { status: 'REJECTED' } }),
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
          marketplaceAds: {
            total: totalMarketplaceAds,
            pending: pendingMarketplaceAds,
            published: publishedMarketplaceAds,
            rejected: rejectedMarketplaceAds
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

