import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

/**
 * Privy Payment Service
 * Handles USDC payments using Privy wallets
 */
@Injectable()
export class PrivyPaymentService {
  private readonly logger = new Logger(PrivyPaymentService.name);
  private readonly USDC_AMOUNT = 0.15; // 0.15 USDC for listings (TESTING)
  
  // USDC contract addresses by chain
  private readonly USDC_CONTRACTS = {
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
    polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC on Polygon
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC on Optimism
    solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC on Solana
    aptos: '0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T', // LayerZero USDC on Aptos
  };

  // Admin wallet addresses to receive payments
  private readonly ADMIN_WALLETS = {
    ethereum: process.env.ADMIN_WALLET_ETHEREUM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    polygon: process.env.ADMIN_WALLET_POLYGON || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    base: process.env.ADMIN_WALLET_BASE || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    arbitrum: process.env.ADMIN_WALLET_ARBITRUM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    optimism: process.env.ADMIN_WALLET_OPTIMISM || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    solana: process.env.ADMIN_WALLET_SOLANA || 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    aptos: process.env.ADMIN_WALLET_APTOS || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  };

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * Create a listing payment using Privy wallet
   * Returns unsigned transaction data that frontend will sign with Privy
   */
  async createListingPayment(userId: number, listingId: string, chain: string = 'base') {
    try {
      this.logger.log(`Creating payment for user ${userId}, listing ${listingId} on ${chain}`);

      // Get user and their primary wallet
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { wallets: true },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (!user.privyUserId) {
        throw new BadRequestException('User is not using Privy authentication');
      }

      // Find user's wallet on the requested chain
      const normalizedChain = chain.toUpperCase();
      const userWallet = user.wallets.find(w => 
        w.blockchain === normalizedChain || 
        (normalizedChain === 'BASE' && w.blockchain === 'ETHEREUM')
      );

      if (!userWallet || !userWallet.address) {
        throw new BadRequestException(`No ${chain} wallet found. Please add a ${chain} wallet to your account.`);
      }

      // Get USDC contract and admin wallet for this chain
      const usdcContract = this.USDC_CONTRACTS[chain.toLowerCase()] || this.USDC_CONTRACTS.base;
      const adminWallet = this.ADMIN_WALLETS[chain.toLowerCase()] || this.ADMIN_WALLETS.base;

      // Create payment record in database
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          amount: this.USDC_AMOUNT,
          currency: 'USDC',
          paymentType: 'LISTING',
          listingId: listingId,
          status: 'PENDING',
          toAddress: adminWallet,
          fromWalletId: userWallet.id,
          metadata: {
            chain,
            fromWallet: userWallet.address,
            toWallet: adminWallet,
            usdcContract,
            paymentMethod: 'PRIVY_WALLET',
          },
        },
      });

      this.logger.log(`✅ Payment record created: ${payment.id}`);

      // Return transaction data for frontend to sign
      return {
        success: true,
        paymentId: payment.id,
        chain,
        transactionData: {
          from: userWallet.address,
          to: adminWallet,
          usdcContract,
          amount: this.USDC_AMOUNT,
          // For EVM chains (Ethereum, Base, Polygon, etc.)
          evmTransactionData: this.buildEVMTransactionData(
            userWallet.address,
            adminWallet,
            usdcContract,
            this.USDC_AMOUNT
          ),
        },
        message: 'Transaction ready. Please sign with your Privy wallet.',
      };
    } catch (error) {
      this.logger.error('Failed to create listing payment', error);
      throw error;
    }
  }

  /**
   * Build EVM transaction data for USDC transfer
   */
  private buildEVMTransactionData(from: string, to: string, usdcContract: string, amount: number) {
    // ERC20 transfer function signature
    const transferFunction = '0xa9059cbb'; // transfer(address,uint256)
    
    // Encode recipient address (remove 0x, pad to 32 bytes)
    const recipientPadded = to.substring(2).padStart(64, '0');
    
    // Encode amount (USDC has 6 decimals, convert to wei)
    const amountWei = (amount * 1_000_000).toString(16).padStart(64, '0');
    
    return {
      to: usdcContract,
      from: from,
      data: `${transferFunction}${recipientPadded}${amountWei}`,
      value: '0x0', // No ETH being sent, just USDC
    };
  }

  /**
   * Verify payment was completed on-chain
   */
  async verifyPayment(paymentId: string) {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        throw new BadRequestException('Payment not found');
      }

      // Mark payment as completed
      const updated = await this.prisma.payment.update({
        where: { id: paymentId },
        data: { 
          status: 'COMPLETED',
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
    } catch (error) {
      this.logger.error('Failed to verify payment', error);
      throw error;
    }
  }
}

