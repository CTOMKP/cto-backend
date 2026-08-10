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

  it('does not let pair-level Moralis metadata override aggregated DexScreener token volume', async () => {
    const service = new SolanaApiService(configService as any);
    jest.spyOn(service as any, 'fetchTokenInfo').mockResolvedValue({
      symbol: 'MNDE',
      name: 'Marinade',
      creation_date: null,
      mint_authority: null,
      freeze_authority: null,
      authority_data_status: 'observed',
      data_sources: {},
    });
    jest.spyOn(service as any, 'fetchHolderData').mockResolvedValue({
      top_holders: [],
      total_holders: null,
      holder_data_status: 'unknown',
    });
    jest.spyOn(service as any, 'fetchLiquidityData').mockResolvedValue({
      price: 0.0188,
      market_cap: 10_270_000,
      volume_24h: 8_786.93,
      pool_count: 14,
      lp_amount_usd: 189_214.21,
      data_source: 'dexscreener',
      liquidity_data_status: 'observed',
      txns_24h: { buys: 354, sells: 180, total: 534 },
    });
    jest.spyOn(service as any, 'fetchMoralisMarket').mockResolvedValue({
      price_usd: 0.018798,
      market_cap_usd: 10_271_298.26,
      volume_24h_usd: 0.13,
    });
    jest.spyOn(service as any, 'analyzeSmartContractRisks').mockResolvedValue({});

    const result = await service.fetchTokenData(mint);

    expect(result.volume_24h).toBe(8_786.93);
    expect(result.volume_24h_source).toBe('dexscreener_token_aggregate');
    expect(result.volume_24h_pool_count).toBe(14);
    expect(result.market_data_version).toBe(SolanaApiService.MARKET_DATA_VERSION);
    expect(result.market_cap).toBe(10_271_298.26);
  });
});
