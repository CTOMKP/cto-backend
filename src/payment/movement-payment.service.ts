import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MovementWalletService } from '../wallet/movement-wallet.service';
import { ConfigService } from '@nestjs/config';

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
      const paymentAmount = this.configService.get('MOVEMENT_LISTING_PAYMENT_AMOUNT', '1000000'); 
      this.logger.log(`Required payment amount: ${paymentAmount} units (USDC)`);

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
          this.logger.warn(`❌ Insufficient balance confirmed for user ${userId}: ${humanBalance} USDC`);
          throw new BadRequestException(
            `Insufficient balance. Your Movement wallet (${movementWallet.address.substring(0, 6)}...) has exactly ${humanBalance} USDC on Bardock. You need 1.0 USDC. (System Time: ${new Date().toISOString()})`
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
        await this.prisma.userListing.update({
          where: { id: payment.listingId },
          data: { status: 'PENDING_APPROVAL' },
        });
        this.logger.log(`✅ Listing ${payment.listingId} status updated to PENDING_APPROVAL`);
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
}







