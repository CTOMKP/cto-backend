import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PrismaService } from '../prisma/prisma.service';
import { SolanaNetworkService } from '../solana/solana-network.service';

@Injectable()
export class SolanaWalletService {
  private readonly logger = new Logger(SolanaWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaNetwork: SolanaNetworkService,
  ) {}

  async assertWalletOwnedByUser(walletId: string, userId: number): Promise<void> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
  }

  private getUsdcMint(): PublicKey {
    return new PublicKey(this.solanaNetwork.getProfile().usdcMint);
  }

  async getWalletBalance(address: string) {
    if (!address) throw new BadRequestException('Wallet address is required');
    const owner = new PublicKey(address);
    const profile = this.solanaNetwork.getProfile();
    const connection = this.solanaNetwork.getConnection(profile.network);
    const usdcMint = new PublicKey(profile.usdcMint);
    try {
      const [solBalance, usdcAta] = await Promise.all([
        connection.getBalance(owner, 'confirmed'),
        getAssociatedTokenAddress(usdcMint, owner, false),
      ]);
      let usdcAmount = '0';
      try {
        const usdcAccount = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
        usdcAmount = usdcAccount?.value?.amount || '0';
      } catch {
        usdcAmount = '0';
      }
      const result = {
        address,
        network: profile.network,
        chainId: profile.chainId,
        solLamports: solBalance,
        sol: solBalance / 1e9,
        usdcAmount,
        usdc: parseFloat(usdcAmount) / 1e6,
        usdcMint: profile.usdcMint,
      };
      this.logger.log(
        `[SOLANA-BALANCE] ${address} network=${profile.network} SOL=${result.sol} USDC=${result.usdc}`,
      );
      return result;
    } catch (error: any) {
      this.logger.warn(
        `[SOLANA-BALANCE] ${profile.network} failed for ${address}: ${error?.message}`,
      );
      throw new BadRequestException('Unable to fetch Solana balance from the configured network');
    }
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

  async pollWalletTransactions(
    walletId: string,
    limit: number = 15,
    overrideAddress?: string,
  ) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet?.address) throw new BadRequestException('Wallet not found');
    if (String(wallet.blockchain).toUpperCase() !== 'SOLANA') {
      throw new BadRequestException('Wallet is not a Solana wallet');
    }

    const profile = this.solanaNetwork.getProfile();
    const connection = this.solanaNetwork.getConnection(profile.network);
    const candidateAddress = (overrideAddress || wallet.address || '').trim();
    let owner: PublicKey;
    try {
      owner = new PublicKey(candidateAddress);
    } catch {
      throw new BadRequestException(
        'Invalid Solana wallet address for polling. Re-sync wallets or pass the current address.',
      );
    }
    const ownerAddress = owner.toBase58();
    if (ownerAddress !== new PublicKey(wallet.address).toBase58()) {
      throw new BadRequestException('The polling address must match the selected wallet');
    }
    const usdcMint = this.getUsdcMint();
    const ownerUsdcAta = (await getAssociatedTokenAddress(usdcMint, owner, false)).toBase58();
    const usdcMintBase58 = usdcMint.toBase58();

    const [ownerSignatures, tokenSignatures] = await Promise.all([
      connection.getSignaturesForAddress(owner, { limit }),
      connection.getSignaturesForAddress(new PublicKey(ownerUsdcAta), { limit }).catch(() => []),
    ]);
    const signatures = [...ownerSignatures, ...tokenSignatures]
      .filter((item, index, all) => all.findIndex((other) => other.signature === item.signature) === index)
      .sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
      .slice(0, limit);
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
      const ownerIndex = accountKeys.findIndex((k) => k === ownerAddress);
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
            return ownerAddr === ownerAddress || tokenAcc === ownerUsdcAta;
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
          fromAddress: usdcDelta < 0 ? ownerAddress : undefined,
          toAddress: usdcDelta > 0 ? ownerAddress : undefined,
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
            fromAddress: solDelta < 0 ? ownerAddress : undefined,
            toAddress: solDelta > 0 ? ownerAddress : undefined,
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

  async recordSentTransaction(params: {
    walletId: string;
    txHash: string;
    asset: 'SOL' | 'USDC';
    amount: string;
    address?: string;
    toAddress?: string;
  }) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: params.walletId } });
    if (!wallet?.address) throw new BadRequestException('Wallet not found');
    if (String(wallet.blockchain).toUpperCase() !== 'SOLANA') {
      throw new BadRequestException('Wallet is not a Solana wallet');
    }

    const ownerAddress = (() => {
      const candidate = (params.address || wallet.address || '').trim();
      try {
        return new PublicKey(candidate).toBase58();
      } catch {
        return wallet.address;
      }
    })();

    const debitTx = await this.recordTransaction({
      walletId: params.walletId,
      txHash: params.txHash,
      txType: 'DEBIT',
      amount: params.amount,
      tokenAddress: params.asset === 'SOL' ? 'solana-native' : 'solana-usdc',
      tokenSymbol: params.asset,
      fromAddress: ownerAddress,
      toAddress: params.toAddress,
      description: `Solana ${params.asset} transfer`,
      metadata: { chain: 'SOLANA', source: 'wallet-send' },
      blockTime: new Date(),
    });

    // Mirror into receiver history when recipient wallet exists in our DB.
    // This makes recipient-side activity persist immediately, independent of RPC polling/indexer lag.
    const recipientRaw = (params.toAddress || '').trim();
    if (recipientRaw) {
      try {
        const recipientAddress = new PublicKey(recipientRaw).toBase58();
        const receiverWallet = await this.prisma.wallet.findFirst({
          where: {
            blockchain: 'SOLANA' as any,
            address: recipientAddress,
          },
        });

        if (receiverWallet && receiverWallet.id !== params.walletId) {
          await this.recordTransaction({
            walletId: receiverWallet.id,
            txHash: params.txHash,
            txType: 'CREDIT',
            amount: params.amount,
            tokenAddress: params.asset === 'SOL' ? 'solana-native' : 'solana-usdc',
            tokenSymbol: params.asset,
            fromAddress: ownerAddress,
            toAddress: recipientAddress,
            description: `Solana ${params.asset} received`,
            metadata: { chain: 'SOLANA', source: 'wallet-send-mirror' },
            blockTime: new Date(),
          });
        }
      } catch {
        // If recipient is invalid/unresolvable, keep sender persistence and skip mirror.
      }
    }

    return debitTx;
  }
}
