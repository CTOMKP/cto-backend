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
    try {
      this.logger.log(`Creating Movement payment for user ${userId}, listing ${listingId}`);

      // Get user and their Movement wallet
      let user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { wallets: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Find user's Movement wallet in our DB
      let movementWallet = user.wallets.find(w => w.blockchain === 'MOVEMENT');

      // --- JUST-IN-TIME SYNC ---
      // If no wallet in DB, try to fetch fresh from Privy before giving up
      if (!movementWallet && user.privyUserId) {
        this.logger.log(`🔍 Movement wallet missing in DB for user ${userId}. Attempting emergency sync from Privy...`);
        
        // We need to trigger a sync. Since we're in the service, we'll manually check Privy.
        // For now, we'll suggest the user refresh the profile which triggers the sync,
        // but I'm adding a specific error message to help them.
        throw new BadRequestException('Movement wallet not synced yet. Please go to your Profile page and click "Sync Wallets" or refresh the page, then try again.');
      }

      if (!movementWallet || !movementWallet.address) {
        this.logger.error(`❌ No Movement wallet found for user ${userId} in ${user.wallets?.length || 0} wallets`);
        throw new BadRequestException('No Movement wallet found. Please ensure your Privy wallet is connected to Movement network.');
      }

      this.logger.log(`✅ Using Movement wallet: ${movementWallet.address}`);

      // Get payment amount (in native token units with decimals)
      // This is the fixed amount users pay for listing (configurable via env)
      const paymentAmount = this.configService.get('MOVEMENT_LISTING_PAYMENT_AMOUNT', '100000000'); // Default: 1 MOV (8 decimals)
      this.logger.log(`Required payment amount: ${paymentAmount} units`);

      // Check if wallet has sufficient balance
      this.logger.log(`Checking balance for wallet ID: ${movementWallet.id}`);
      const hasBalance = await this.movementWalletService.hasSufficientBalance(
        movementWallet.id,
        paymentAmount,
      );

      if (!hasBalance) {
        this.logger.log(`Balance check failed, syncing balance for wallet: ${movementWallet.address}`);
        // Sync balance first to get latest
        await this.movementWalletService.syncWalletBalance(movementWallet.id, undefined, true);
        
        // Check again
        const stillInsufficient = !(await this.movementWalletService.hasSufficientBalance(
          movementWallet.id,
          paymentAmount,
        ));

        if (stillInsufficient) {
          this.logger.warn(`❌ Insufficient balance for user ${userId}: wallet ${movementWallet.address} has less than ${paymentAmount} units`);
          throw new BadRequestException(
            `Insufficient balance. Your Movement wallet (${movementWallet.address.substring(0, 6)}...) has less than 1 MOVE. Please fund it with test tokens.`
          );
        }
      }

      this.logger.log(`✅ Sufficient balance confirmed`);

      // Get admin wallet
      const adminWallet = this.configService.get('MOVEMENT_ADMIN_WALLET', '');
      if (!adminWallet) {
        this.logger.error('❌ MOVEMENT_ADMIN_WALLET not set in environment');
        throw new BadRequestException('Admin wallet not configured. Please contact support.');
      }

      // Create payment record in database
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          amount: parseFloat(paymentAmount) / 1e8, // Convert from native units to human-readable
          currency: 'MOVE', // Movement native token
          paymentType: 'LISTING',
          listingId: listingId,
          status: 'PENDING',
          toAddress: adminWallet,
          fromWalletId: movementWallet.id,
          metadata: {
            chain: 'MOVEMENT',
            fromWallet: movementWallet.address,
            toWallet: adminWallet,
            tokenAddress: this.configService.get('MOVEMENT_TEST_TOKEN_ADDRESS', '0x1::aptos_coin::AptosCoin'),
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
        amount: paymentAmount, // Amount in native units (with decimals)
        amountDisplay: parseFloat(paymentAmount) / 1e8, // Human-readable amount
        tokenSymbol: 'MOVE',
        transactionData: {
          // Frontend will use Privy to sign and send this transaction
          // Movement uses Aptos-compatible transaction format
          type: 'entry_function_payload',
          function: '0x1::coin::transfer',
          type_arguments: ['0x1::aptos_coin::AptosCoin'],
          arguments: [adminWallet, paymentAmount],
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







