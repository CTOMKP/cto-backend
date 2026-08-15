import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { CreatorProgramService } from '../creator-program/creator-program.service';
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { SolanaNetworkProfile, SolanaNetworkService } from '../solana/solana-network.service';

@Injectable()
export class SolanaPaymentService {
  private readonly logger = new Logger(SolanaPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaNetwork: SolanaNetworkService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
    private readonly creatorProgramService: CreatorProgramService,
  ) {}

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
    const amount = process.env.SOLANA_LISTING_PAYMENT_AMOUNT || '1000000'; // 1.0 USDC (6 decimals)
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new BadRequestException('SOLANA_LISTING_PAYMENT_AMOUNT must be a positive integer');
    }
    return amount;
  }

  async getListingQuote(userId: number, listingId: string) {
    const listing = await this.prisma.userListing.findUnique({
      where: { id: listingId },
      select: { userId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.userId !== userId) throw new ForbiddenException('Not your listing');
    const profile = this.solanaNetwork.getProfile();
    const amountAtomic = this.getListingPaymentAmount();
    return {
      success: true,
      network: profile.network,
      chainId: profile.chainId,
      currency: 'USDC',
      tokenAddress: profile.usdcMint,
      amountAtomic,
      amountDisplay: Number(amountAtomic) / 1e6,
    };
  }

  private async recordCreatorRevenueForPayment(payment: {
    id: string;
    paymentType: string;
    userId: number;
    amount: number;
    listingId?: string | null;
    marketplaceAdId?: string | null;
    metadata?: any;
  }) {
    if (payment.paymentType !== 'LISTING' && payment.paymentType !== 'MARKETPLACE_AD') {
      return;
    }

    const sourceType = payment.paymentType === 'LISTING' ? 'LISTING_FEE' : 'MARKETPLACE_AD';
    const amountGross = Number(payment.amount || 0);
    if (!Number.isFinite(amountGross) || amountGross <= 0) {
      return;
    }

    try {
      await this.creatorProgramService.recordPaymentRevenue({
        paymentId: payment.id,
        sourceType: sourceType as any,
        payerUserId: payment.userId,
        amountGross,
        platformFeeAmount: amountGross,
        metadata: {
          paymentId: payment.id,
          paymentType: payment.paymentType,
          listingId: payment.listingId || null,
          marketplaceAdId: payment.marketplaceAdId || null,
          chain: 'SOLANA',
          ...(payment.metadata || {}),
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to record creator revenue for Solana payment ${payment.id}: ${error?.message || error}`,
      );
    }
  }

  private async buildUsdcTransfer(
    fromAddress: string,
    amount: string,
    profile: SolanaNetworkProfile,
  ) {
    const connection = this.solanaNetwork.getConnection(profile.network);
    const mint = new PublicKey(profile.usdcMint);
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(profile.treasuryWallet);

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
      transactionMessageBase64: Buffer.from(transaction.serializeMessage()).toString('base64'),
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      recentBlockhash: latestBlockhash.blockhash,
      fromAta: fromAta.toBase58(),
      toAta: toAta.toBase58(),
    };
  }

  async createListingPayment(userId: number, listingId: string) {
    const listing = await this.prisma.userListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.userId !== userId) throw new ForbiddenException('Not your listing');
    const completed = await this.prisma.payment.findFirst({
      where: { userId, listingId, paymentType: 'LISTING', status: 'COMPLETED' },
    });
    if (completed) {
      return {
        success: true,
        alreadyCompleted: true,
        paymentId: completed.id,
        message: 'Payment already completed',
      };
    }
    if (listing.status !== 'DRAFT') {
      throw new BadRequestException('Only draft listings can be paid');
    }
    const wallet = await this.getUserSolanaWallet(userId);
    const profile = this.solanaNetwork.getProfile();
    const paymentAmount = this.getListingPaymentAmount();
    const tx = await this.buildUsdcTransfer(wallet.address!, paymentAmount, profile);
    const quotedAt = new Date();
    const existing = await this.prisma.payment.findFirst({
      where: { userId, listingId, paymentType: 'LISTING', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const paymentData = {
        userId,
        amount: parseFloat(paymentAmount) / 1e6,
        currency: 'USDC',
        paymentType: 'LISTING' as const,
        listingId,
        status: 'PENDING' as const,
        toAddress: profile.treasuryWallet,
        fromWalletId: wallet.id,
        network: profile.network,
        tokenAddress: profile.usdcMint,
        amountAtomic: paymentAmount,
        fromAddress: wallet.address,
        quotedAt,
        metadata: {
          chain: 'SOLANA',
          network: profile.network,
          fromWallet: wallet.address,
          fromTokenAccount: tx.fromAta,
          toWallet: profile.treasuryWallet,
          toTokenAccount: tx.toAta,
          tokenAddress: profile.usdcMint,
          paymentMethod: 'SOLANA_PRIVY',
          amountInNativeUnits: paymentAmount,
          transactionMessageBase64: tx.transactionMessageBase64,
          recentBlockhash: tx.recentBlockhash,
          lastValidBlockHeight: tx.lastValidBlockHeight,
        },
      };
    const payment = existing
      ? await this.prisma.payment.update({ where: { id: existing.id }, data: paymentData })
      : await this.prisma.payment.create({ data: paymentData });

    return {
      success: true,
      paymentId: payment.id,
      chain: 'solana',
      network: profile.network,
      chainId: profile.chainId,
      fromAddress: wallet.address,
      toAddress: profile.treasuryWallet,
      amount: paymentAmount,
      amountDisplay: parseFloat(paymentAmount) / 1e6,
      tokenAddress: profile.usdcMint,
      tokenSymbol: 'USDC',
      transaction: tx.transactionBase64,
      lastValidBlockHeight: tx.lastValidBlockHeight,
      recentBlockhash: tx.recentBlockhash,
      message: 'Transaction ready. Please sign with your Privy Solana wallet.',
    };
  }

  async createMarketplaceAdPayment(userId: number, marketplaceAdId: string) {
    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id: marketplaceAdId } });
    if (!ad) throw new NotFoundException('Marketplace ad not found');
    if (ad.userId !== userId) throw new ForbiddenException('Not your marketplace ad');
    const amountUsd = Number(ad.totalPrice || 0);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { success: true, message: 'No payment required for this ad' };
    }
    const completed = await this.prisma.payment.findFirst({
      where: { userId, marketplaceAdId, paymentType: 'MARKETPLACE_AD', status: 'COMPLETED' },
    });
    if (completed) {
      return {
        success: true,
        alreadyCompleted: true,
        paymentId: completed.id,
        message: 'Payment already completed',
      };
    }
    if (ad.status !== 'DRAFT') throw new BadRequestException('Only draft ads can be paid');
    const wallet = await this.getUserSolanaWallet(userId);
    const profile = this.solanaNetwork.getProfile();
    const paymentAmount = Math.round(amountUsd * 1e6).toString();
    const tx = await this.buildUsdcTransfer(wallet.address!, paymentAmount, profile);
    const quotedAt = new Date();
    const existing = await this.prisma.payment.findFirst({
      where: { userId, marketplaceAdId, paymentType: 'MARKETPLACE_AD', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    const paymentData = {
        userId,
        amount: amountUsd,
        currency: 'USDC',
        paymentType: 'MARKETPLACE_AD' as const,
        marketplaceAdId,
        status: 'PENDING' as const,
        toAddress: profile.treasuryWallet,
        fromWalletId: wallet.id,
        network: profile.network,
        tokenAddress: profile.usdcMint,
        amountAtomic: paymentAmount,
        fromAddress: wallet.address,
        quotedAt,
        metadata: {
          chain: 'SOLANA',
          network: profile.network,
          fromWallet: wallet.address,
          fromTokenAccount: tx.fromAta,
          toWallet: profile.treasuryWallet,
          toTokenAccount: tx.toAta,
          tokenAddress: profile.usdcMint,
          paymentMethod: 'SOLANA_PRIVY',
          amountInNativeUnits: paymentAmount,
          transactionMessageBase64: tx.transactionMessageBase64,
          recentBlockhash: tx.recentBlockhash,
          lastValidBlockHeight: tx.lastValidBlockHeight,
        },
      };
    const payment = existing
      ? await this.prisma.payment.update({ where: { id: existing.id }, data: paymentData })
      : await this.prisma.payment.create({ data: paymentData });

    return {
      success: true,
      paymentId: payment.id,
      chain: 'solana',
      network: profile.network,
      chainId: profile.chainId,
      fromAddress: wallet.address,
      toAddress: profile.treasuryWallet,
      amount: paymentAmount,
      amountDisplay: amountUsd,
      tokenAddress: profile.usdcMint,
      tokenSymbol: 'USDC',
      transaction: tx.transactionBase64,
      lastValidBlockHeight: tx.lastValidBlockHeight,
      recentBlockhash: tx.recentBlockhash,
      message: 'Transaction ready. Please sign with your Privy Solana wallet.',
    };
  }

  async broadcastPayment(paymentId: string, signedTransaction: string, userId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new ForbiddenException('Not your payment');
    if (payment.status !== 'PENDING') throw new BadRequestException('Payment is not pending');
    const metadata = (payment.metadata || {}) as any;
    const expectedMessage = metadata.transactionMessageBase64;
    if (!expectedMessage) throw new BadRequestException('Payment quote has expired. Create it again.');
    let signed: Transaction;
    try {
      signed = Transaction.from(Buffer.from(signedTransaction, 'base64'));
    } catch {
      throw new BadRequestException('Invalid signed Solana transaction');
    }
    if (Buffer.from(signed.serializeMessage()).toString('base64') !== expectedMessage) {
      throw new BadRequestException('Signed transaction does not match the server payment quote');
    }
    const expectedSigner = payment.fromAddress || metadata.fromWallet;
    const signer = signed.signatures.find((item) => item.publicKey.toBase58() === expectedSigner);
    if (!signer?.signature) throw new BadRequestException('Transaction was not signed by the paying wallet');
    const network = payment.network || metadata.network || this.solanaNetwork.getActiveNetwork();
    const connection = this.solanaNetwork.getConnection(network);
    try {
      const txHash = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        {
          signature: txHash,
          blockhash: String(metadata.recentBlockhash),
          lastValidBlockHeight: Number(metadata.lastValidBlockHeight),
        },
        'finalized',
      );
      return { success: true, txHash, network };
    } catch (error: any) {
      throw new BadRequestException(error?.message || 'Unable to broadcast Solana payment');
    }
  }

  private async verifyOnChain(payment: any, txHash: string) {
    const metadata = (payment.metadata || {}) as any;
    const network = payment.network || metadata.network ||
      (payment.tokenAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        ? 'mainnet-beta'
        : this.solanaNetwork.getActiveNetwork());
    const profile = this.solanaNetwork.getProfile(network);
    const connection = this.solanaNetwork.getConnection(profile.network, 'finalized');
    const usdcMint = payment.tokenAddress || metadata.tokenAddress || profile.usdcMint;
    const adminWallet = payment.toAddress || metadata.toWallet;
    const fromWallet = payment.fromAddress || metadata.fromWallet;
    const requiredAmount = payment.amountAtomic || metadata.amountInNativeUnits;
    if (!usdcMint || !adminWallet || !fromWallet || !requiredAmount || BigInt(requiredAmount) <= 0n) {
      throw new BadRequestException('Payment quote is incomplete. Create the payment again.');
    }
    const tx = await connection.getParsedTransaction(txHash, {
      maxSupportedTransactionVersion: 0,
      commitment: 'finalized',
    });

    if (!tx?.meta) {
      throw new BadRequestException('Transaction not found or not finalized yet.');
    }
    if (tx.meta.err) {
      throw new BadRequestException('The Solana transaction failed on-chain.');
    }
    const quotedAt = payment.quotedAt ? new Date(payment.quotedAt).getTime() : payment.createdAt.getTime();
    if (tx.blockTime && tx.blockTime * 1000 < quotedAt - 120_000) {
      throw new BadRequestException('Transaction predates this payment quote.');
    }

    const pre = tx.meta.preTokenBalances || [];
    const post = tx.meta.postTokenBalances || [];
    const sumByOwner = (balances: readonly any[], owner: string) => {
      return balances
        .filter((b) => b.mint === usdcMint && b.owner === owner)
        .reduce<bigint>((acc, b) => acc + BigInt(b.uiTokenAmount?.amount || '0'), 0n);
    };
    const treasuryDelta = sumByOwner(post, adminWallet) - sumByOwner(pre, adminWallet);
    const payerDelta = sumByOwner(pre, fromWallet) - sumByOwner(post, fromWallet);
    if (treasuryDelta !== BigInt(requiredAmount) || payerDelta !== BigInt(requiredAmount)) {
      throw new BadRequestException('Payment amount does not match required total.');
    }
    return { network: profile.network, tokenAddress: usdcMint };
  }

  async verifyPayment(paymentId: string, txHash: string, userId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new ForbiddenException('Not your payment');
    if (payment.status === 'COMPLETED') {
      if (payment.txHash && payment.txHash !== txHash) {
        throw new BadRequestException('Payment was already completed with another transaction');
      }
      await this.recordCreatorRevenueForPayment(payment as any);
      return { success: true, payment, message: 'Payment already verified' };
    }
    if (payment.status !== 'PENDING') throw new BadRequestException('Payment is not pending');
    const reused = await this.prisma.payment.findFirst({
      where: { txHash, id: { not: paymentId } },
      select: { id: true },
    });
    if (reused) throw new BadRequestException('This transaction has already been used for another payment');

    await this.verifyOnChain(payment, txHash);
    let updatedListing: any = null;
    let updatedAd: any = null;
    let updated: any;
    try {
      updated = await this.prisma.$transaction(async (database) => {
        const claim = await database.payment.updateMany({
          where: { id: paymentId, status: 'PENDING' },
          data: { status: 'COMPLETED', txHash, completedAt: new Date() },
        });
        if (claim.count !== 1) throw new BadRequestException('Payment is already being processed');
        if (payment.paymentType === 'LISTING' && payment.listingId) {
          updatedListing = await database.userListing.update({
            where: { id: payment.listingId },
            data: { status: 'PENDING_APPROVAL' },
            include: { user: { select: { email: true, name: true } } },
          });
        }
        if (payment.paymentType === 'MARKETPLACE_AD' && payment.marketplaceAdId) {
          updatedAd = await database.marketplaceAd.update({
            where: { id: payment.marketplaceAdId },
            data: { status: 'PENDING_APPROVAL' },
            include: { user: { select: { email: true, name: true } } },
          });
        }
        return database.payment.findUnique({ where: { id: paymentId } });
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('This transaction has already been used for another payment');
      }
      throw error;
    }

    await this.recordCreatorRevenueForPayment(updated as any);
    if (updatedListing?.user?.email) {
      await this.emailService.sendListingPendingEmail({
        to: updatedListing.user.email,
        userName: updatedListing.user.name,
        listingId: updatedListing.id,
        projectTitle: updatedListing.title,
      });
    }
    if (updatedAd?.user?.email) {
      await this.emailService.sendMarketplaceAdPendingEmail({
        to: updatedAd.user.email,
        userName: updatedAd.user.name,
        adId: updatedAd.id,
        adTitle: updatedAd.title,
      });
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

  async verifyMarketplaceAdPayment(paymentId: string, txHash: string, userId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paymentType !== 'MARKETPLACE_AD') throw new BadRequestException('Invalid payment type');
    return this.verifyPayment(paymentId, txHash, userId);
  }
}
