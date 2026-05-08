import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

@Injectable()
export class SolanaPaymentService {
  private readonly logger = new Logger(SolanaPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  private getConnection(): Connection {
    const rpcUrl =
      this.configService.get('SOLANA_RPC_URL') ||
      'https://api.mainnet-beta.solana.com';
    return new Connection(rpcUrl, 'confirmed');
  }

  private getUsdcMint(): string {
    return (
      this.configService.get('SOLANA_USDC_MINT') ||
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );
  }

  private getAdminWallet(): string {
    return (
      this.configService.get('SOLANA_ADMIN_WALLET') ||
      this.configService.get('ADMIN_WALLET_SOLANA') ||
      'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
    );
  }

  private async getUserSolanaWallet(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const wallet =
      user.wallets.find((w) => w.blockchain?.toString().toUpperCase() === 'SOLANA') ||
      (await this.prisma.wallet.findFirst({
        where: { userId, blockchain: 'SOLANA' as any },
      }));

    if (!wallet?.address) {
      throw new BadRequestException('No Solana wallet found for your account. Please connect a Solana wallet in Privy.');
    }

    return wallet;
  }

  private getListingPaymentAmount(): string {
    return this.configService.get('SOLANA_LISTING_PAYMENT_AMOUNT', '1000000'); // 1.0 USDC (6 decimals)
  }

  private async buildUsdcTransfer(
    fromAddress: string,
    toAddress: string,
    amount: string,
  ) {
    const connection = this.getConnection();
    const mint = new PublicKey(this.getUsdcMint());
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(toAddress);

    const [fromAta, toAta, latestBlockhash] = await Promise.all([
      getAssociatedTokenAddress(mint, fromPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      getAssociatedTokenAddress(mint, toPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      connection.getLatestBlockhash('confirmed'),
    ]);

    const instructions = [];

    const fromAtaInfo = await connection.getAccountInfo(fromAta, 'confirmed');
    if (!fromAtaInfo) {
      throw new BadRequestException('USDC token account not found for this wallet.');
    }

    const toAtaInfo = await connection.getAccountInfo(toAta, 'confirmed');
    if (!toAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(fromPubkey, toAta, toPubkey, mint),
      );
    }

    instructions.push(
      createTransferCheckedInstruction(
        fromAta,
        mint,
        toAta,
        fromPubkey,
        BigInt(amount),
        6,
      ),
    );

    const transaction = new Transaction({
      feePayer: fromPubkey,
      recentBlockhash: latestBlockhash.blockhash,
    }).add(...instructions);

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return {
      transactionBase64: Buffer.from(serialized).toString('base64'),
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      recentBlockhash: latestBlockhash.blockhash,
      fromAta: fromAta.toBase58(),
      toAta: toAta.toBase58(),
    };
  }

  async createListingPayment(userId: number, listingId: string) {
    const wallet = await this.getUserSolanaWallet(userId);
    const paymentAmount = this.getListingPaymentAmount();
    const adminWallet = this.getAdminWallet();

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amount: parseFloat(paymentAmount) / 1e6,
        currency: 'USDC',
        paymentType: 'LISTING',
        listingId,
        status: 'PENDING',
        toAddress: adminWallet,
        fromWalletId: wallet.id,
        metadata: {
          chain: 'SOLANA',
          fromWallet: wallet.address,
          toWallet: adminWallet,
          tokenAddress: this.getUsdcMint(),
          paymentMethod: 'SOLANA_PRIVY',
          amountInNativeUnits: paymentAmount,
        },
      },
    });

    const tx = await this.buildUsdcTransfer(wallet.address!, adminWallet, paymentAmount);

    return {
      success: true,
      paymentId: payment.id,
      chain: 'solana',
      fromAddress: wallet.address,
      toAddress: adminWallet,
      amount: paymentAmount,
      amountDisplay: parseFloat(paymentAmount) / 1e6,
      tokenSymbol: 'USDC',
      transaction: tx.transactionBase64,
      lastValidBlockHeight: tx.lastValidBlockHeight,
      recentBlockhash: tx.recentBlockhash,
      message: 'Transaction ready. Please sign with your Privy Solana wallet.',
    };
  }

  async createMarketplaceAdPayment(userId: number, marketplaceAdId: string, amountUsd: number) {
    if (!amountUsd || amountUsd <= 0) throw new BadRequestException('Payment amount must be greater than 0');
    const wallet = await this.getUserSolanaWallet(userId);
    const adminWallet = this.getAdminWallet();
    const paymentAmount = Math.round(amountUsd * 1e6).toString();

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amount: parseFloat(paymentAmount) / 1e6,
        currency: 'USDC',
        paymentType: 'MARKETPLACE_AD',
        marketplaceAdId,
        status: 'PENDING',
        toAddress: adminWallet,
        fromWalletId: wallet.id,
        metadata: {
          chain: 'SOLANA',
          fromWallet: wallet.address,
          toWallet: adminWallet,
          tokenAddress: this.getUsdcMint(),
          paymentMethod: 'SOLANA_PRIVY',
          amountInNativeUnits: paymentAmount,
        },
      },
    });

    const tx = await this.buildUsdcTransfer(wallet.address!, adminWallet, paymentAmount);

    return {
      success: true,
      paymentId: payment.id,
      chain: 'solana',
      fromAddress: wallet.address,
      toAddress: adminWallet,
      amount: paymentAmount,
      amountDisplay: parseFloat(paymentAmount) / 1e6,
      tokenSymbol: 'USDC',
      transaction: tx.transactionBase64,
      lastValidBlockHeight: tx.lastValidBlockHeight,
      recentBlockhash: tx.recentBlockhash,
      message: 'Transaction ready. Please sign with your Privy Solana wallet.',
    };
  }

  private async verifyOnChain(txHash: string, requiredAmount: string, adminWallet: string) {
    const connection = this.getConnection();
    const usdcMint = this.getUsdcMint();
    const tx = await connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx?.meta) {
      throw new BadRequestException('Transaction not found or not confirmed yet.');
    }

    const pre = tx.meta.preTokenBalances || [];
    const post = tx.meta.postTokenBalances || [];

    const sumByOwner = (balances: any[]) => {
      return balances
        .filter((b) => b.mint === usdcMint && b.owner === adminWallet)
        .reduce((acc, b) => acc + BigInt(b.uiTokenAmount?.amount || '0'), BigInt(0));
    };

    const preSum = sumByOwner(pre);
    const postSum = sumByOwner(post);
    const delta = postSum - preSum;

    if (delta < BigInt(requiredAmount)) {
      throw new BadRequestException('Payment amount does not match required total.');
    }

    return true;
  }

  async verifyPayment(paymentId: string, txHash: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'COMPLETED') {
      return { success: true, payment, message: 'Payment already verified' };
    }

    const amountInNativeUnits = (payment.metadata as any)?.amountInNativeUnits || '0';
    const adminWallet = this.getAdminWallet();
    await this.verifyOnChain(txHash, amountInNativeUnits, adminWallet);

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        txHash,
        completedAt: new Date(),
      },
    });

    if (payment.paymentType === 'LISTING' && payment.listingId) {
      const updatedListing = await this.prisma.userListing.update({
        where: { id: payment.listingId },
        data: { status: 'PENDING_APPROVAL' },
        include: {
          user: { select: { email: true, name: true } },
        },
      });

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

      if (updatedAd.user?.email) {
        await this.emailService.sendMarketplaceAdPendingEmail({
          to: updatedAd.user.email,
          userName: updatedAd.user.name,
          adId: updatedAd.id,
          adTitle: updatedAd.title,
        });
      }
    }

    await this.notifications.createNotification({
      userId: payment.userId,
      type: 'PAYMENT',
      title: 'Payment confirmed',
      body: payment.paymentType,
      data: { paymentId: payment.id, paymentType: payment.paymentType },
    });

    return { success: true, payment: updated };
  }

  async verifyMarketplaceAdPayment(paymentId: string, txHash: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paymentType !== 'MARKETPLACE_AD') throw new BadRequestException('Invalid payment type');
    return this.verifyPayment(paymentId, txHash);
  }
}
