import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type TokenAccumulator = {
  tokenSymbol: string;
  rawAmount: bigint;
  decimals: number | null;
  transactionCount: number;
};

@Injectable()
export class WalletSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeToken(tokenSymbol?: string | null) {
    const symbol = String(tokenSymbol || 'UNKNOWN').trim().toUpperCase();
    if (symbol.includes('USDC')) return { tokenSymbol: 'USDC', decimals: 6 };
    if (symbol === 'SOL') return { tokenSymbol: 'SOL', decimals: 9 };
    if (symbol === 'MOVE' || symbol === 'MOV') return { tokenSymbol: 'MOVE', decimals: 8 };
    return { tokenSymbol: symbol || 'UNKNOWN', decimals: null };
  }

  private parseRawAmount(amount: string) {
    try {
      const normalized = String(amount || '0').trim();
      if (!/^\d+$/.test(normalized)) return 0n;
      return BigInt(normalized);
    } catch {
      return 0n;
    }
  }

  private formatRawAmount(rawAmount: bigint, decimals: number) {
    const divisor = 10n ** BigInt(decimals);
    const whole = rawAmount / divisor;
    const fraction = (rawAmount % divisor)
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '');

    return fraction ? `${whole}.${fraction}` : whole.toString();
  }

  async getTotalPaidOut(userId: number) {
    const withdrawals = await this.prisma.walletTransaction.findMany({
      where: {
        wallet: { userId },
        txType: 'DEBIT',
        status: 'COMPLETED',
      },
      select: {
        amount: true,
        tokenSymbol: true,
      },
    });

    const totals = new Map<string, TokenAccumulator>();

    for (const withdrawal of withdrawals) {
      const token = this.normalizeToken(withdrawal.tokenSymbol);
      const current = totals.get(token.tokenSymbol) ?? {
        tokenSymbol: token.tokenSymbol,
        rawAmount: 0n,
        decimals: token.decimals,
        transactionCount: 0,
      };

      current.rawAmount += this.parseRawAmount(withdrawal.amount);
      current.transactionCount += 1;
      totals.set(token.tokenSymbol, current);
    }

    const byToken = Array.from(totals.values())
      .map((total) => {
        const formattedAmount =
          total.decimals == null
            ? null
            : this.formatRawAmount(total.rawAmount, total.decimals);

        return {
          tokenSymbol: total.tokenSymbol,
          rawAmount: total.rawAmount.toString(),
          decimals: total.decimals,
          amount: formattedAmount == null ? null : Number(formattedAmount),
          formattedAmount,
          transactionCount: total.transactionCount,
        };
      })
      .sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol));

    const usdc = byToken.find((total) => total.tokenSymbol === 'USDC');
    const totalPaidOutUsd = usdc?.amount ?? 0;

    return {
      totalPaidOut: totalPaidOutUsd,
      totalPaidOutUsd,
      currency: 'USD',
      tokenSymbol: 'USDC',
      transactionCount: withdrawals.length,
      byToken,
      calculatedAt: new Date().toISOString(),
    };
  }
}
