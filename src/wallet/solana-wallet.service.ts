import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SolanaWalletService {
  private readonly logger = new Logger(SolanaWalletService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getConnection(): Connection {
    const rpcUrl =
      this.configService.get('SOLANA_RPC_URL') ||
      'https://api.devnet.solana.com';
    return new Connection(rpcUrl, 'confirmed');
  }

  private getUsdcMint(): PublicKey {
    const mint =
      this.configService.get('SOLANA_USDC_MINT') ||
      '6e5qtpMzrLzDM8R6fHQtoF6d2iybHBYdj56tceKZo9sn';
    return new PublicKey(mint);
  }

  async getWalletBalance(address: string) {
    if (!address) throw new BadRequestException('Wallet address is required');
    const connection = this.getConnection();
    const owner = new PublicKey(address);
    const usdcMint = this.getUsdcMint();

    const [solBalance, usdcAta] = await Promise.all([
      connection.getBalance(owner, 'confirmed'),
      getAssociatedTokenAddress(usdcMint, owner, false),
    ]);

    let usdcAmount = '0';
    try {
      const usdcAccount = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
      usdcAmount = usdcAccount?.value?.amount || '0';
    } catch (error: any) {
      // If ATA doesn't exist, balance is zero
      this.logger.debug(`USDC ATA missing or unreadable for ${address}: ${error?.message}`);
    }

    return {
      address,
      solLamports: solBalance,
      sol: solBalance / 1e9,
      usdcAmount,
      usdc: parseFloat(usdcAmount) / 1e6,
      usdcMint: usdcMint.toBase58(),
    };
  }

  async getWalletTransactions(walletId: string, limit: number = 20) {
    return (this.prisma as any).walletTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async recordTransaction(data: {
    walletId: string;
    txHash: string;
    txType: 'CREDIT' | 'DEBIT';
    amount: string;
    tokenAddress: string;
    tokenSymbol: string;
    fromAddress?: string;
    toAddress?: string;
    description?: string;
    metadata?: any;
    blockTime?: Date;
  }) {
    const existing = await (this.prisma as any).walletTransaction.findUnique({
      where: {
        walletId_txHash: {
          walletId: data.walletId,
          txHash: data.txHash,
        },
      },
    });
    if (existing) return existing;

    return (this.prisma as any).walletTransaction.create({
      data: {
        walletId: data.walletId,
        txHash: data.txHash,
        txType: data.txType,
        amount: data.amount,
        tokenAddress: data.tokenAddress,
        tokenSymbol: data.tokenSymbol,
        fromAddress: data.fromAddress,
        toAddress: data.toAddress,
        status: 'COMPLETED',
        description: data.description,
        metadata: data.metadata,
        blockTime: data.blockTime,
      },
    });
  }

  async pollWalletTransactions(walletId: string, limit: number = 15) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet?.address) throw new BadRequestException('Wallet not found');
    if (String(wallet.blockchain).toUpperCase() !== 'SOLANA') {
      throw new BadRequestException('Wallet is not a Solana wallet');
    }

    const connection = this.getConnection();
    const owner = new PublicKey(wallet.address);
    const usdcMint = this.getUsdcMint();
    const ownerUsdcAta = (await getAssociatedTokenAddress(usdcMint, owner, false)).toBase58();
    const usdcMintBase58 = usdcMint.toBase58();

    const signatures = await connection.getSignaturesForAddress(owner, { limit });
    if (!signatures.length) return [];

    const parsed = await connection.getParsedTransactions(
      signatures.map((s) => s.signature),
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    );

    const created: any[] = [];
    for (let i = 0; i < signatures.length; i += 1) {
      const sig = signatures[i];
      const txAny: any = parsed[i];
      if (!txAny?.meta || !txAny?.transaction?.message) continue;

      const message: any = txAny.transaction.message;
      const accountKeys: string[] = (message.accountKeys || []).map((k: any) =>
        typeof k === 'string' ? k : String(k?.pubkey || ''),
      );
      const ownerIndex = accountKeys.findIndex((k) => k === wallet.address);
      const preBalances: number[] = txAny.meta.preBalances || [];
      const postBalances: number[] = txAny.meta.postBalances || [];
      const preTokenBalances: any[] = txAny.meta.preTokenBalances || [];
      const postTokenBalances: any[] = txAny.meta.postTokenBalances || [];
      const blockTime = sig.blockTime ? new Date(sig.blockTime * 1000) : undefined;

      const sumUsdc = (items: any[]) =>
        items
          .filter((tb) => String(tb?.mint || '') === usdcMintBase58)
          .filter((tb) => {
            const ownerAddr = String(tb?.owner || '');
            const idx = typeof tb?.accountIndex === 'number' ? tb.accountIndex : -1;
            const tokenAcc = idx >= 0 && idx < accountKeys.length ? accountKeys[idx] : '';
            return ownerAddr === wallet.address || tokenAcc === ownerUsdcAta;
          })
          .reduce((acc, tb) => acc + Number(tb?.uiTokenAmount?.amount || 0), 0);

      const preUsdc = sumUsdc(preTokenBalances);
      const postUsdc = sumUsdc(postTokenBalances);
      const usdcDelta = postUsdc - preUsdc;

      let recorded = null;
      if (usdcDelta !== 0) {
        recorded = await this.recordTransaction({
          walletId,
          txHash: sig.signature,
          txType: usdcDelta < 0 ? 'DEBIT' : 'CREDIT',
          amount: String(Math.abs(usdcDelta)),
          tokenAddress: 'solana-usdc',
          tokenSymbol: 'USDC',
          fromAddress: usdcDelta < 0 ? wallet.address : undefined,
          toAddress: usdcDelta > 0 ? wallet.address : undefined,
          description: 'Solana USDC transfer',
          metadata: { chain: 'SOLANA' },
          blockTime,
        });
      } else if (ownerIndex >= 0 && ownerIndex < preBalances.length && ownerIndex < postBalances.length) {
        const solDelta = (postBalances[ownerIndex] || 0) - (preBalances[ownerIndex] || 0);
        if (solDelta !== 0) {
          recorded = await this.recordTransaction({
            walletId,
            txHash: sig.signature,
            txType: solDelta < 0 ? 'DEBIT' : 'CREDIT',
            amount: String(Math.abs(solDelta)),
            tokenAddress: 'solana-native',
            tokenSymbol: 'SOL',
            fromAddress: solDelta < 0 ? wallet.address : undefined,
            toAddress: solDelta > 0 ? wallet.address : undefined,
            description: 'Solana SOL transfer',
            metadata: { chain: 'SOLANA' },
            blockTime,
          });
        }
      }

      if (recorded) created.push(recorded);
    }

    return created;
  }
}
