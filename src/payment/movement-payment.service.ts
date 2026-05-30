import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MovementWalletService } from '../wallet/movement-wallet.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { CreatorProgramService } from '../creator-program/creator-program.service';

/**
 * Movement Payment Service
 * Handles payments using Movement test tokens
 */
@Injectable()
export class MovementPaymentService {
  private readonly logger = new Logger(MovementPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly movementWalletService: MovementWalletService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
    private readonly creatorProgramService: CreatorProgramService,
  ) {}

  /**
   * Create a listing payment using Movement wallet
   * Returns payment record and transaction data for frontend to sign
   */
  async createListingPayment(userId: number, listingId: string) {
    // IMMEDIATE LOG TO CONFIRM REQUEST REACHED SERVICE
    this.logger.log(`🚀 [CRITICAL] createListingPayment starting for User: ${userId}, Listing: ${listingId}`);
    
    try {

      // Get user and their Movement wallet
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { wallets: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Find user's Movement wallet - BE EXTRA RESILIENT
      // Check for 'MOVEMENT' or 'APTOS' and ignore case
      let movementWallet = user.wallets.find(w => 
        w.blockchain?.toString().toUpperCase() === 'MOVEMENT' || 
        w.blockchain?.toString().toUpperCase() === 'APTOS'
      );

      // If still not found in the 'include', try a direct fresh query to be 100% sure
      if (!movementWallet) {
        this.logger.log(`🔍 Wallet not in 'include' array, trying direct query for User ${userId}...`);
        const freshWallet = await this.prisma.wallet.findFirst({
          where: {
            userId: userId,
            blockchain: {
              in: ['MOVEMENT', 'APTOS'] as any
            }
          }
        });
        if (freshWallet) {
          movementWallet = freshWallet;
          this.logger.log(`✅ Found wallet via direct query: ${movementWallet.address}`);
        }
      }

      // --- JUST-IN-TIME SYNC ---
      // If still no wallet in DB, try to fetch fresh from Privy before giving up
      if (!movementWallet && user.privyUserId) {
        this.logger.log(`🔍 Movement wallet missing in DB for user ${userId}. Attempting emergency sync from Privy...`);
        // ... rest of logic remains same
      }

      if (!movementWallet || !movementWallet.address) {
        const walletCount = user.wallets?.length || 0;
        const blockchains = user.wallets?.map(w => `${w.blockchain}:${w.address.substring(0, 6)}`).join(', ') || 'none';
        this.logger.error(`❌ Wallet mismatch for user ${userId}: found ${walletCount} wallets (${blockchains}), but no MOVEMENT wallet.`);
        throw new BadRequestException(`No Movement wallet found for your account (User ID: ${userId}). Backend found ${walletCount} wallets: [${blockchains}]. Please try logging out and back in.`);
      }

      this.logger.log(`✅ Using Movement wallet: ${movementWallet.address}`);

      // Get payment amount (in native token units with decimals)
      // For USDC (6 decimals): 1,000,000 = 1.0 USDC
      let paymentAmount = this.configService.get('MOVEMENT_LISTING_PAYMENT_AMOUNT', '1000000'); 
      
      // SAFETY CHECK: If the amount is set to 100,000,000 (100 USDC) but we intended 1 USDC, 
      // we log a warning but respect the config.
      const humanRequired = parseFloat(paymentAmount) / 1e6;
      this.logger.log(`💰 Payment check: User has 1 USDC? Amount units: ${paymentAmount} (${humanRequired} USDC)`);

      // Check if wallet has sufficient balance
      this.logger.log(`Checking balance for wallet ID: ${movementWallet.id}`);
      const hasBalance = await this.movementWalletService.hasSufficientBalance(
        movementWallet.id,
        paymentAmount,
      );

      if (!hasBalance) {
        this.logger.log(`[BALANCE_RESCUE] DB says insufficient balance for ${movementWallet.address}. Performing direct blockchain check...`);
        
        // SYNC FRESH FROM BLOCKCHAIN RIGHT NOW
        const freshBalanceData = await this.movementWalletService.getWalletBalance(movementWallet.address, undefined, true);
        this.logger.log(`[BALANCE_RESCUE] Blockchain reports: ${freshBalanceData.balance} units`);

        // Update DB immediately with this fresh info
        await this.movementWalletService.syncWalletBalance(movementWallet.id, undefined, true);
        
        const nowHasBalance = BigInt(freshBalanceData.balance) >= BigInt(paymentAmount);

        if (!nowHasBalance) {
          const humanBalance = parseFloat(freshBalanceData.balance) / 1e6;
          const humanRequired = parseFloat(paymentAmount) / 1e6;
          this.logger.warn(`❌ Insufficient balance confirmed for user ${userId}: ${humanBalance} USDC (Required: ${humanRequired})`);
          throw new BadRequestException(
            `Insufficient balance. Your Movement wallet (${movementWallet.address.substring(0, 6)}...) has exactly ${humanBalance} USDC on Bardock. You need ${humanRequired.toFixed(1)} USDC. (System Time: ${new Date().toISOString()})`
          );
        }
      }

      this.logger.log(`✅ Sufficient balance confirmed`);

      // Get admin wallet
      const adminWallet = this.configService.get('MOVEMENT_ADMIN_WALLET', '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523');
      const usdcAddress = this.configService.get('MOVEMENT_TEST_TOKEN_ADDRESS', '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7');

      // Create payment record in database
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          amount: parseFloat(paymentAmount) / 1e6, // Convert from units to USDC (6 decimals)
          currency: 'USDC', 
          paymentType: 'LISTING',
          listingId: listingId,
          status: 'PENDING',
          toAddress: adminWallet,
          fromWalletId: movementWallet.id,
          metadata: {
            chain: 'MOVEMENT',
            fromWallet: movementWallet.address,
            toWallet: adminWallet,
            tokenAddress: usdcAddress,
            paymentMethod: 'MOVEMENT_WALLET',
            amountInNativeUnits: paymentAmount,
          },
        },
      });

      this.logger.log(`✅ Payment record created: ${payment.id}`);

      // Return transaction data for frontend to sign with Privy
      return {
        success: true,
        paymentId: payment.id,
        chain: 'movement',
        fromAddress: movementWallet.address,
        toAddress: adminWallet,
        amount: paymentAmount, 
        amountDisplay: parseFloat(paymentAmount) / 1e6, 
        tokenSymbol: 'USDC.e',
        transactionData: {
          type: 'entry_function_payload',
          function: '0x1::primary_fungible_store::transfer',
          type_arguments: ['0x1::fungible_asset::Metadata'],
          arguments: [usdcAddress, adminWallet, paymentAmount],
        },
        message: 'Transaction ready. Please sign with your Privy Movement wallet.',
      };
    } catch (error: any) {
      this.logger.error('Failed to create Movement payment', error);
      throw error;
    }
  }

  /**
   * Create a marketplace ad payment using Movement wallet
   * Returns payment record and transaction data for frontend to sign
   */
  async createMarketplaceAdPayment(userId: number, marketplaceAdId: string, amountUsd: number) {
    this.logger.log(`🚀 [CRITICAL] createMarketplaceAdPayment starting for User: ${userId}, Ad: ${marketplaceAdId}`);

    try {
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { wallets: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      let movementWallet = user.wallets.find(w =>
        w.blockchain?.toString().toUpperCase() === 'MOVEMENT' ||
        w.blockchain?.toString().toUpperCase() === 'APTOS'
      );

      if (!movementWallet) {
        this.logger.log(`🔍 Wallet not in 'include' array, trying direct query for User ${userId}...`);
        const freshWallet = await this.prisma.wallet.findFirst({
          where: {
            userId: userId,
            blockchain: {
              in: ['MOVEMENT', 'APTOS'] as any
            }
          }
        });
        if (freshWallet) {
          movementWallet = freshWallet;
          this.logger.log(`✅ Found wallet via direct query: ${movementWallet.address}`);
        }
      }

      if (!movementWallet || !movementWallet.address) {
        const walletCount = user.wallets?.length || 0;
        const blockchains = user.wallets?.map(w => `${w.blockchain}:${w.address.substring(0, 6)}`).join(', ') || 'none';
        this.logger.error(`❌ Wallet mismatch for user ${userId}: found ${walletCount} wallets (${blockchains}), but no MOVEMENT wallet.`);
        throw new BadRequestException(`No Movement wallet found for your account (User ID: ${userId}). Backend found ${walletCount} wallets: [${blockchains}]. Please try logging out and back in.`);
      }

      this.logger.log(`✅ Using Movement wallet: ${movementWallet.address}`);

      if (!amountUsd || amountUsd <= 0) {
        throw new BadRequestException('Payment amount must be greater than 0');
      }

      const paymentAmount = Math.round(amountUsd * 1e6).toString();
      const humanRequired = parseFloat(paymentAmount) / 1e6;
      this.logger.log(`💰 Marketplace ad payment amount: ${paymentAmount} (${humanRequired} USDC)`);

      const hasBalance = await this.movementWalletService.hasSufficientBalance(
        movementWallet.id,
        paymentAmount,
      );

      if (!hasBalance) {
        this.logger.log(`[BALANCE_RESCUE] DB says insufficient balance for ${movementWallet.address}. Performing direct blockchain check...`);
        const freshBalanceData = await this.movementWalletService.getWalletBalance(movementWallet.address, undefined, true);
        await this.movementWalletService.syncWalletBalance(movementWallet.id, undefined, true);

        const nowHasBalance = BigInt(freshBalanceData.balance) >= BigInt(paymentAmount);
        if (!nowHasBalance) {
          const humanBalance = parseFloat(freshBalanceData.balance) / 1e6;
          this.logger.warn(`❌ Insufficient balance confirmed for user ${userId}: ${humanBalance} USDC (Required: ${humanRequired})`);
          throw new BadRequestException(
            `Insufficient balance. Your Movement wallet (${movementWallet.address.substring(0, 6)}...) has exactly ${humanBalance} USDC on Bardock. You need ${humanRequired.toFixed(1)} USDC. (System Time: ${new Date().toISOString()})`
          );
        }
      }

      const adminWallet = this.configService.get('MOVEMENT_ADMIN_WALLET', '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523');
      const usdcAddress = this.configService.get('MOVEMENT_TEST_TOKEN_ADDRESS', '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7');

      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          amount: parseFloat(paymentAmount) / 1e6,
          currency: 'USDC',
          paymentType: 'MARKETPLACE_AD',
          marketplaceAdId,
          status: 'PENDING',
          toAddress: adminWallet,
          fromWalletId: movementWallet.id,
          metadata: {
            chain: 'MOVEMENT',
            fromWallet: movementWallet.address,
            toWallet: adminWallet,
            tokenAddress: usdcAddress,
            paymentMethod: 'MOVEMENT_WALLET',
            amountInNativeUnits: paymentAmount,
          },
        },
      });

      this.logger.log(`✅ Marketplace payment record created: ${payment.id}`);

      return {
        success: true,
        paymentId: payment.id,
        chain: 'movement',
        fromAddress: movementWallet.address,
        toAddress: adminWallet,
        amount: paymentAmount,
        amountDisplay: parseFloat(paymentAmount) / 1e6,
        tokenSymbol: 'USDC.e',
        transactionData: {
          type: 'entry_function_payload',
          function: '0x1::primary_fungible_store::transfer',
          type_arguments: ['0x1::fungible_asset::Metadata'],
          arguments: [usdcAddress, adminWallet, paymentAmount],
        },
        message: 'Transaction ready. Please sign with your Privy Movement wallet.',
      };
    } catch (error: any) {
      this.logger.error('Failed to create Movement marketplace payment', error);
      throw error;
    }
  }

  /**
   * Create an escrow funding payment using Movement wallet
   */
  async createEscrowPayment(userId: number, escrowId: string, amountUsd?: number) {
    this.logger.log(`🚀 [CRITICAL] createEscrowPayment starting for User: ${userId}, Escrow: ${escrowId}`);

    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow not found');
    if (escrow.posterId !== userId) throw new BadRequestException('Only poster can fund escrow');
    if (escrow.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException('Escrow not awaiting payment');
    }

    const amountToCharge = amountUsd && amountUsd > 0 ? amountUsd : escrow.totalAmount;
    if (!amountToCharge || amountToCharge <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    let user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let movementWallet = user.wallets.find(w =>
      w.blockchain?.toString().toUpperCase() === 'MOVEMENT' ||
      w.blockchain?.toString().toUpperCase() === 'APTOS'
    );
    if (!movementWallet) {
      const freshWallet = await this.prisma.wallet.findFirst({
        where: { userId, blockchain: { in: ['MOVEMENT', 'APTOS'] as any } },
      });
      if (freshWallet) movementWallet = freshWallet;
    }
    if (!movementWallet || !movementWallet.address) {
      throw new BadRequestException('No Movement wallet found for your account');
    }

    const paymentAmount = Math.round(amountToCharge * 1e6).toString();
    const hasBalance = await this.movementWalletService.hasSufficientBalance(
      movementWallet.id,
      paymentAmount,
    );
    if (!hasBalance) {
      const freshBalanceData = await this.movementWalletService.getWalletBalance(movementWallet.address, undefined, true);
      await this.movementWalletService.syncWalletBalance(movementWallet.id, undefined, true);
      const nowHasBalance = BigInt(freshBalanceData.balance) >= BigInt(paymentAmount);
      if (!nowHasBalance) {
        throw new BadRequestException('Insufficient balance');
      }
    }

    const adminWallet = this.configService.get(
      'MOVEMENT_ADMIN_WALLET',
      '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523'
    );
    const usdcAddress = this.configService.get(
      'MOVEMENT_TEST_TOKEN_ADDRESS',
      '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7'
    );

    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        amount: parseFloat(paymentAmount) / 1e6,
        currency: 'USDC',
        paymentType: 'ESCROW',
        escrowId,
        status: 'PENDING',
        toAddress: adminWallet,
        fromWalletId: movementWallet.id,
        metadata: {
          chain: 'MOVEMENT',
          fromWallet: movementWallet.address,
          toWallet: adminWallet,
          tokenAddress: usdcAddress,
          paymentMethod: 'MOVEMENT_WALLET',
          amountInNativeUnits: paymentAmount,
        },
      },
    });

    return {
      success: true,
      paymentId: payment.id,
      chain: 'movement',
      fromAddress: movementWallet.address,
      toAddress: adminWallet,
      amount: paymentAmount,
      amountDisplay: parseFloat(paymentAmount) / 1e6,
      tokenSymbol: 'USDC.e',
      transactionData: {
        type: 'entry_function_payload',
        function: '0x1::primary_fungible_store::transfer',
        type_arguments: ['0x1::fungible_asset::Metadata'],
        arguments: [usdcAddress, adminWallet, paymentAmount],
      },
      message: 'Transaction ready. Please sign with your Privy Movement wallet.',
    };
  }

  /**
   * Verify payment was completed on-chain
   * Called after frontend confirms transaction
   */
  async verifyPayment(paymentId: string, txHash: string) {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      if (payment.status === 'COMPLETED') {
        // Recovery path: if client retries verify for an already completed payment,
        // ensure pending-review email still exists for listing/ad flows.
        if (payment.paymentType === 'LISTING' && payment.listingId) {
          const listing = await this.prisma.userListing.findUnique({
            where: { id: payment.listingId },
            include: { user: { select: { email: true, name: true } } },
          });
          if (listing?.status === 'PENDING_APPROVAL' && listing.user?.email) {
            await this.emailService.sendListingPendingEmail({
              to: listing.user.email,
              userName: listing.user.name,
              listingId: listing.id,
              projectTitle: listing.title,
            });
          }
        }
        if (payment.paymentType === 'MARKETPLACE_AD' && payment.marketplaceAdId) {
          const ad = await this.prisma.marketplaceAd.findUnique({
            where: { id: payment.marketplaceAdId },
            include: { user: { select: { email: true, name: true } } },
          });
          if (ad?.status === 'PENDING_APPROVAL' && ad.user?.email) {
            await this.emailService.sendMarketplaceAdPendingEmail({
              to: ad.user.email,
              userName: ad.user.name,
              adId: ad.id,
              adTitle: ad.title,
            });
          }
        }
        return {
          success: true,
          payment,
          message: 'Payment already verified',
        };
      }

      // Get wallet
      const wallet = await this.prisma.wallet.findUnique({
        where: { id: payment.fromWalletId || '' },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      // Debit balance from wallet
      await this.movementWalletService.debitBalance(
        wallet.id,
        (BigInt((payment.metadata as any)?.amountInNativeUnits || '0')).toString(),
        txHash,
        paymentId,
      );

      // Update payment status
      const updated = await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'COMPLETED',
          txHash: txHash,
          completedAt: new Date(),
        },
      });

      // If this is a listing payment, update listing status to PENDING_APPROVAL
      if (payment.paymentType === 'LISTING' && payment.listingId) {
        const updatedListing = await this.prisma.userListing.update({
          where: { id: payment.listingId },
          data: { status: 'PENDING_APPROVAL' },
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        });
        this.logger.log(`✅ Listing ${payment.listingId} status updated to PENDING_APPROVAL`);

        if (updatedListing.user?.email) {
          await this.emailService.sendListingPendingEmail({
            to: updatedListing.user.email,
            userName: updatedListing.user.name,
            listingId: updatedListing.id,
            projectTitle: updatedListing.title,
          });
        }
      }

      if (payment.paymentType === 'MARKETPLACE_AD' && payment.marketplaceAdId) {
        const updatedAd = await this.prisma.marketplaceAd.update({
          where: { id: payment.marketplaceAdId },
          data: { status: 'PENDING_APPROVAL' },
          include: {
            user: { select: { email: true, name: true } },
          },
        });
        this.logger.log(`Marketplace ad ${payment.marketplaceAdId} status updated to PENDING_APPROVAL`);
        if (updatedAd.user?.email) {
          await this.emailService.sendMarketplaceAdPendingEmail({
            to: updatedAd.user.email,
            userName: updatedAd.user.name,
            adId: updatedAd.id,
            adTitle: updatedAd.title,
          });
        }
      }

      if (payment.paymentType === 'ESCROW' && payment.escrowId) {
        const updatedEscrow = await this.prisma.escrow.update({
          where: { id: payment.escrowId },
          data: { status: 'FUNDED_ACTIVE', fundedAt: new Date() },
        });
        this.logger.log(`✅ Escrow ${payment.escrowId} status updated to FUNDED_ACTIVE`);

        await this.notifications.createNotification({
          userId: updatedEscrow.posterId,
          type: 'ESCROW',
          title: 'Escrow funded',
          body: updatedEscrow.title,
          data: { escrowId: updatedEscrow.id },
        });
        await this.notifications.createNotification({
          userId: updatedEscrow.applicantId,
          type: 'ESCROW',
          title: 'Escrow funded',
          body: updatedEscrow.title,
          data: { escrowId: updatedEscrow.id },
        });
      }

      await this.notifications.createNotification({
        userId: payment.userId,
        type: 'PAYMENT',
        title: 'Payment confirmed',
        body: payment.paymentType,
        data: { paymentId: payment.id, paymentType: payment.paymentType },
      });

      if (payment.paymentType === 'LISTING' || payment.paymentType === 'MARKETPLACE_AD') {
        try {
          await this.creatorProgramService.recordPaymentRevenue({
            paymentId,
            sourceType: payment.paymentType === 'LISTING' ? 'LISTING_FEE' : 'MARKETPLACE_AD',
            payerUserId: payment.userId,
            amountGross: Number(payment.amount || 0),
            platformFeeAmount: Number(payment.amount || 0),
            metadata: {
              paymentId,
              paymentType: payment.paymentType,
              txHash,
            },
          });
        } catch (creatorError: any) {
          this.logger.warn(`Creator revenue recording failed for payment ${paymentId}: ${creatorError?.message || creatorError}`);
        }
      }

      this.logger.log(`✅ Payment verified: ${paymentId}`);

      return {
        success: true,
        payment: updated,
      };
    } catch (error: any) {
      this.logger.error('Failed to verify payment', error);
      throw error;
    }
  }

  async verifyMarketplaceAdPayment(paymentId: string, txHash: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paymentType !== 'MARKETPLACE_AD') throw new BadRequestException('Invalid payment type');

    if (payment.marketplaceAdId) {
      const ad = await this.prisma.marketplaceAd.findUnique({ where: { id: payment.marketplaceAdId } });
      if (!ad) throw new NotFoundException('Marketplace ad not found');
      if (ad.totalPrice && payment.amount < ad.totalPrice) {
        throw new BadRequestException('Payment amount does not match required total');
      }
    }

    return this.verifyPayment(paymentId, txHash);
  }
}

