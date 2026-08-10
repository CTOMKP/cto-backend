import axios from 'axios';
import { SolanaApiService } from './solana-api.service';

describe('SolanaApiService DexScreener market data', () => {
  const mint = 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey';
  const configService = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the best pool for liquidity and aggregates token volume across unique matching pools', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        pairs: [
          {
            chainId: 'solana',
            pairAddress: 'deep-pool',
            baseToken: { address: mint },
            quoteToken: { address: 'mSOL' },
            liquidity: { usd: 189_214.21 },
            volume: { h24: 0.13 },
            txns: { h24: { buys: 3, sells: 5 } },
            priceUsd: '0.0188',
            marketCap: 10_270_000,
            pairCreatedAt: Date.now() - 86_400_000,
          },
          {
            chainId: 'solana',
            pairAddress: 'active-pool',
            baseToken: { address: mint },
            quoteToken: { address: 'USDC' },
            liquidity: { usd: 40_152.93 },
            volume: { h24: 1_203.92 },
            txns: { h24: { buys: 1, sells: 23 } },
            priceUsd: '0.0187',
            marketCap: 10_260_000,
            pairCreatedAt: Date.now() - 86_400_000,
          },
          {
            chainId: 'solana',
            pairAddress: 'active-pool',
            baseToken: { address: mint },
            quoteToken: { address: 'USDC' },
            liquidity: { usd: 40_152.93 },
            volume: { h24: 1_203.92 },
            txns: { h24: { buys: 1, sells: 23 } },
          },
          {
            chainId: 'solana',
            pairAddress: 'unrelated-pool',
            baseToken: { address: 'another-token' },
            quoteToken: { address: 'USDC' },
            liquidity: { usd: 1_000_000 },
            volume: { h24: 9_000_000 },
            txns: { h24: { buys: 1_000, sells: 1_000 } },
          },
        ],
      },
    } as any);

    const service = new SolanaApiService(configService as any);
    const result = await (service as any).fetchLiquidityData(mint);

    expect(result.lp_amount_usd).toBe(189_214.21);
    expect(result.volume_24h).toBeCloseTo(1_204.05, 2);
    expect(result.txns_24h).toEqual({ buys: 4, sells: 28, total: 32 });
    expect(result.pool_count).toBe(2);
    expect(result.pair_address).toBe('deep-pool');
    expect(result.data_source).toBe('dexscreener');
  });
});
