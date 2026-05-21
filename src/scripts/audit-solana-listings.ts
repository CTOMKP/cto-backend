import { PrismaClient, Chain } from '@prisma/client';
import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

type AuditStatus = 'TRADABLE' | 'NOT_TRADABLE' | 'INVALID';

async function checkTradable(mint: string): Promise<{ status: AuditStatus; reason: string }> {
  try {
    new PublicKey(mint);
  } catch {
    return { status: 'INVALID', reason: 'Invalid Solana mint format' };
  }

  try {
    const { data } = await axios.get('https://api.jup.ag/swap/v1/quote', {
      params: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: mint,
        amount: '1000000',
        slippageBps: '50',
        swapMode: 'ExactIn',
        onlyDirectRoutes: 'false',
      },
      timeout: 12000,
    });

    const routePlan = Array.isArray(data?.routePlan) ? data.routePlan : [];
    if (!data?.outAmount || routePlan.length === 0) {
      return { status: 'NOT_TRADABLE', reason: 'No Jupiter route/liquidity' };
    }
    return { status: 'TRADABLE', reason: 'Jupiter route available' };
  } catch (error: any) {
    const reason =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      'Quote check failed';
    const lowered = String(reason).toLowerCase();
    if (lowered.includes('not tradable') || lowered.includes('no route') || lowered.includes('liquidity')) {
      return { status: 'NOT_TRADABLE', reason: String(reason) };
    }
    return { status: 'NOT_TRADABLE', reason: `Quote error: ${String(reason)}` };
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const listings = await prisma.listing.findMany({
      where: { chain: Chain.SOLANA },
      select: { contractAddress: true, symbol: true, name: true },
      orderBy: { updatedAt: 'asc' },
    });

    const rows: Array<{
      contractAddress: string;
      symbol: string | null;
      name: string | null;
      status: AuditStatus;
      reason: string;
    }> = [];

    for (const listing of listings) {
      const result = await checkTradable(listing.contractAddress);
      rows.push({
        contractAddress: listing.contractAddress,
        symbol: listing.symbol || null,
        name: listing.name || null,
        status: result.status,
        reason: result.reason,
      });
      await new Promise((r) => setTimeout(r, 120));
    }

    const outDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `solana-listings-audit-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 2), 'utf8');

    const summary = rows.reduce(
      (acc, r) => {
        acc[r.status] += 1;
        return acc;
      },
      { TRADABLE: 0, NOT_TRADABLE: 0, INVALID: 0 },
    );

    // eslint-disable-next-line no-console
    console.log('Audit complete:', summary);
    // eslint-disable-next-line no-console
    console.log('Output:', outFile);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

