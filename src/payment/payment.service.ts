import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosRequestHeaders } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingPaymentDto, CreateAdBoostPaymentDto } from './dto/payment.dto';
import { v4 as uuidv4 } from 'uuid';

// Pricing configuration (in USDC)
const PRICING = {
  LISTING: 50, // $50 USDC to list a token
  AD_BOOST: {
    top: 100,       // $100/day - Top of listings
    priority: 75,    // $75/day - Priority placement
    bump: 50,        // $50 - One-time bump to top
    spotlight: 150,  // $150/day - Spotlight section
    homepage: 200,   // $200/day - Homepage featured
    urgent: 125      // $125/day - Urgent badge
  }
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private base = process.env.CIRCLE_API_BASE || 'https://api.circle.com/v1/w3s';
  private apiKey = process.env.CIRCLE_API_KEY || '';
  private platformWalletAddress = process.env.PLATFORM_WALLET_ADDRESS || ''; // Platform's receiving wallet

  constructor(private prisma: PrismaService) {}

  private headers(userToken?: string): AxiosRequestHeaders {
    const h: AxiosRequestHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    } as Record<string, string>;
    if (userToken) h['X-User-Token'] = userToken;
    return h;
  }

  // Pay for token listing
  async payForListing(dto: CreateListingPaymentDto) {
    try {
      // Get user and listing
      const user = await this.prisma.user.findUnique({ where: { email: dto.userId } });
      if (!user) throw new BadRequestException('User not found');

      const listing = await this.prisma.userListing.findUnique({ where: { id: dto.listingId } });
      if (!listing) throw new NotFoundException('Listing not found');

      if (listing.userId !== user.id) {
        throw new BadRequestException('You can only pay for your own listings');
      }

      if (listing.status === 'PUBLISHED') {
        throw new BadRequestException('Listing is already published');
      }

      // Get user's wallet
      let walletId = dto.walletId;
      if (!walletId) {
        const wallet = await this.prisma.wallet.findFirst({ where: { userId: user.id } });
        if (!wallet) throw new BadRequestException('No wallet found. Please create a wallet first.');
        walletId = wallet.circleWalletId;
      }

      // Get user token
      const userToken = await this.getUserToken(dto.userId);

      // Check balance
      const balanceResp = await axios.get(
        `${this.base}/wallets/${walletId}/balances`,
        { headers: this.headers(userToken) }
      );

      const tokenBalances = balanceResp.data?.data?.tokenBalances || [];
      const usdcBalance = tokenBalances.find((b: { token?: { symbol?: string } }) => 
        b.token?.symbol === 'USDC'
      );
      
      const currentBalance = parseFloat(usdcBalance?.amount || '0');
      const requiredAmount = PRICING.LISTING;

      if (currentBalance < requiredAmount) {
        throw new BadRequestException(
          `Insufficient balance. Required: ${requiredAmount} USDC, Available: ${currentBalance} USDC`
        );
      }

      // Create payment record
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          paymentType: 'LISTING',
          listingId: dto.listingId,
          amount: requiredAmount,
          currency: 'USDC',
          status: 'PENDING',
          fromWalletId: walletId,
          toAddress: this.platformWalletAddress,
          description: `Payment for listing: ${listing.title}`,
        }
      });

      // Initiate Circle transfer to platform wallet
      const transferData = {
        idempotencyKey: `listing_payment_${payment.id}_${uuidv4()}`,
        source: {
          type: 'wallet',
          id: walletId
        },
        destination: {
          type: 'blockchain',
          address: this.platformWalletAddress,
          chain: 'APTOS-TESTNET'
        },
        amount: {
          amount: requiredAmount.toString(),
          currency: 'USDC'
        },
        fee: {
          type: 'blockchain'
        }
      };

      const transferResp = await axios.post(
        `${this.base}/transfers`,
        transferData,
        { headers: this.headers(userToken) }
      );

      const transfer = transferResp.data?.data;

      // Update payment with transfer ID
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          transferId: transfer.id,
          status: 'PROCESSING',
          txHash: transfer.txHash
        }
      });

      this.logger.log(`Listing payment initiated: ${payment.id} for listing ${dto.listingId}`);

      return {
        success: true,
        paymentId: payment.id,
        transferId: transfer.id,
        amount: requiredAmount,
        currency: 'USDC',
        status: 'PROCESSING',
        message: 'Payment initiated successfully. Listing will be published once payment is confirmed.',
        nextStep: 'Wait for blockchain confirmation (5-15 minutes)'
      };

    } catch (error: unknown) {
      this.logger.error('Listing payment failed:', error instanceof Error ? error.message : 'Unknown error');
      
      if (axios.isAxiosError(error) && error.response?.data) {
        throw new BadRequestException(`Payment failed: ${error.response.data.message || 'Unknown error'}`);
      }
      
      throw new BadRequestException(`Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Pay for ad boost
  async payForAdBoost(dto: CreateAdBoostPaymentDto) {
    try {
      // Get user and listing
      const user = await this.prisma.user.findUnique({ where: { email: dto.userId } });
      if (!user) throw new BadRequestException('User not found');

      const listing = await this.prisma.userListing.findUnique({ where: { id: dto.listingId } });
      if (!listing) throw new NotFoundException('Listing not found');

      if (listing.userId !== user.id) {
        throw new BadRequestException('You can only boost your own listings');
      }

      // Calculate price based on boost type and duration
      const pricePerDay = PRICING.AD_BOOST[dto.boostType as keyof typeof PRICING.AD_BOOST];
      const totalAmount = dto.boostType === 'bump' ? pricePerDay : pricePerDay * dto.durationDays;

      // Get user's wallet
      let walletId = dto.walletId;
      if (!walletId) {
        const wallet = await this.prisma.wallet.findFirst({ where: { userId: user.id } });
        if (!wallet) throw new BadRequestException('No wallet found. Please create a wallet first.');
        walletId = wallet.circleWalletId;
      }

      // Get user token
      const userToken = await this.getUserToken(dto.userId);

      // Check balance
      const balanceResp = await axios.get(
        `${this.base}/wallets/${walletId}/balances`,
        { headers: this.headers(userToken) }
      );

      const tokenBalances = balanceResp.data?.data?.tokenBalances || [];
      const usdcBalance = tokenBalances.find((b: { token?: { symbol?: string } }) => 
        b.token?.symbol === 'USDC'
      );
      
      const currentBalance = parseFloat(usdcBalance?.amount || '0');

      if (currentBalance < totalAmount) {
        throw new BadRequestException(
          `Insufficient balance. Required: ${totalAmount} USDC, Available: ${currentBalance} USDC`
        );
      }

      // Create ad boost record
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + dto.durationDays);

      const adBoost = await this.prisma.adBoost.create({
        data: {
          listingId: dto.listingId,
          type: dto.boostType,
          durationDays: dto.durationDays,
          startDate: new Date(),
          endDate: endDate
        }
      });

      // Create payment record
      const payment = await this.prisma.payment.create({
        data: {
          userId: user.id,
          paymentType: 'AD_BOOST',
          listingId: dto.listingId,
          adBoostId: adBoost.id,
          amount: totalAmount,
          currency: 'USDC',
          status: 'PENDING',
          fromWalletId: walletId,
          toAddress: this.platformWalletAddress,
          description: `Ad boost (${dto.boostType}) for ${dto.durationDays} days`,
          metadata: {
            boostType: dto.boostType,
            durationDays: dto.durationDays,
            pricePerDay: pricePerDay
          }
        }
      });

      // Initiate Circle transfer
      const transferData = {
        idempotencyKey: `ad_boost_payment_${payment.id}_${uuidv4()}`,
        source: {
          type: 'wallet',
          id: walletId
        },
        destination: {
          type: 'blockchain',
          address: this.platformWalletAddress,
          chain: 'APTOS-TESTNET'
        },
        amount: {
          amount: totalAmount.toString(),
          currency: 'USDC'
        },
        fee: {
          type: 'blockchain'
        }
      };

      const transferResp = await axios.post(
        `${this.base}/transfers`,
        transferData,
        { headers: this.headers(userToken) }
      );

      const transfer = transferResp.data?.data;

      // Update payment with transfer ID
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          transferId: transfer.id,
          status: 'PROCESSING',
          txHash: transfer.txHash
        }
      });

      this.logger.log(`Ad boost payment initiated: ${payment.id} for listing ${dto.listingId}`);

      return {
        success: true,
        paymentId: payment.id,
        transferId: transfer.id,
        adBoostId: adBoost.id,
        amount: totalAmount,
        currency: 'USDC',
        boostType: dto.boostType,
        durationDays: dto.durationDays,
        startDate: adBoost.startDate,
        endDate: adBoost.endDate,
        status: 'PROCESSING',
        message: 'Payment initiated successfully. Ad boost will activate once payment is confirmed.',
        nextStep: 'Wait for blockchain confirmation (5-15 minutes)'
      };

    } catch (error: unknown) {
      this.logger.error('Ad boost payment failed:', error instanceof Error ? error.message : 'Unknown error');
      
      if (axios.isAxiosError(error) && error.response?.data) {
        throw new BadRequestException(`Payment failed: ${error.response.data.message || 'Unknown error'}`);
      }
      
      throw new BadRequestException(`Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Verify and complete payment
  async verifyPayment(paymentId: string, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { email: userId } });
      if (!user) throw new BadRequestException('User not found');

      const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundException('Payment not found');

      if (payment.userId !== user.id) {
        throw new BadRequestException('You can only verify your own payments');
      }

      if (payment.status === 'COMPLETED') {
        return {
          success: true,
          payment,
          message: 'Payment already completed'
        };
      }

      if (!payment.transferId) {
        throw new BadRequestException('No transfer ID found for this payment');
      }

      // Get user token and check transfer status
      const userToken = await this.getUserToken(userId);
      
      const transferResp = await axios.get(
        `${this.base}/transfers/${payment.transferId}`,
        { headers: this.headers(userToken) }
      );

      const transfer = transferResp.data?.data;
      const transferStatus = transfer.status;

      // Update payment status based on transfer status
      let paymentStatus = payment.status;
      if (transferStatus === 'COMPLETE' || transferStatus === 'CONFIRMED') {
        paymentStatus = 'COMPLETED';
        
        // If this is a listing payment, publish the listing
        if (payment.paymentType === 'LISTING' && payment.listingId) {
          await this.prisma.userListing.update({
            where: { id: payment.listingId },
            data: { status: 'PUBLISHED' }
          });
        }

        await this.prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: paymentStatus,
            completedAt: new Date(),
            txHash: transfer.txHash || payment.txHash
          }
        });

        this.logger.log(`Payment completed: ${paymentId}`);
      } else if (transferStatus === 'FAILED' || transferStatus === 'REJECTED') {
        paymentStatus = 'FAILED';
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { status: paymentStatus }
        });
      }

      return {
        success: true,
        payment: await this.prisma.payment.findUnique({ where: { id: paymentId } }),
        transferStatus: transferStatus,
        message: `Payment status: ${paymentStatus}`
      };

    } catch (error: unknown) {
      this.logger.error('Payment verification failed:', error instanceof Error ? error.message : 'Unknown error');
      
      if (axios.isAxiosError(error) && error.response?.data) {
        throw new BadRequestException(`Verification failed: ${error.response.data.message || 'Unknown error'}`);
      }
      
      throw new BadRequestException(`Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get payment history
  async getPaymentHistory(userId: string, paymentType?: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { email: userId } });
      if (!user) throw new BadRequestException('User not found');

      const payments = await this.prisma.payment.findMany({
        where: {
          userId: user.id,
          ...(paymentType && { paymentType })
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        payments,
        total: payments.length,
        message: 'Payment history retrieved successfully'
      };

    } catch (error: unknown) {
      this.logger.error('Failed to get payment history:', error instanceof Error ? error.message : 'Unknown error');
      throw new BadRequestException(`Failed to get payment history: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get pricing information
  getPricing() {
    return {
      success: true,
      pricing: {
        listing: PRICING.LISTING,
        adBoosts: PRICING.AD_BOOST
      },
      currency: 'USDC',
      message: 'Pricing information retrieved successfully'
    };
  }

  private async getUserToken(userId: string): Promise<string> {
    const tokenResp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() }
    );
    const userToken = tokenResp.data?.data?.userToken;
    if (!userToken) throw new BadRequestException('Failed to obtain user token');
    return userToken;
  }
}

