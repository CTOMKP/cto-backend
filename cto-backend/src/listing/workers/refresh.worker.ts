import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { ScanService } from '../../scan/services/scan.service';
import { ListingRepository } from '../repository/listing.repository';
import { CacheService } from '../services/cache.service';
import { MetricsService } from '../services/metrics.service';
import { ListingGateway } from '../services/listing.gateway';

/*
  RefreshWorker
  -------------
  - Every 2 minutes: fetch trending/new SOL pairs from DexScreener and upsert basic market metadata.
  - Every 5 minutes: rescan known listings to enrich risk/tier/summary.
  - Non-blocking, short Redis cache (60-120s) to reduce API calls.
*/
@Injectable()
export class RefreshWorker {
  private readonly logger = new Logger(RefreshWorker.name);
  private queue: (string | { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' })[] = [];
  private running = false;
  private stats = { cycles: 0, refreshed: 0, apiCalls: 0, failures: 0, lastDurationMs: 0 };
  private readonly dexBase = process.env.DEXSCREENER_URL || 'https://api.dexscreener.com/latest';

  constructor(
    private readonly scanService: ScanService,
    private readonly repo: ListingRepository,
    private readonly cache: CacheService,
    private readonly metrics: MetricsService,
    private readonly gateway: ListingGateway,
  ) {}

  enqueue(contract: string | { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' }) {
    this.queue.push(contract as any);
    this.run();
  }

  // Pull trending/new SOL pairs (approx) from DexScreener using /dex/tokens & /dex/search endpoints
  @Cron('*/30 * * * * *')
  async scheduledFetchFeed() {
    const started = Date.now();
    let apiCalls = 0;
    let failures = 0;
    try {
      const dex = await this.getDexScreenerFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; });
      const bird = await this.getBirdEyeFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; });
      const heli = await this.getHeliusFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; });
      const moralis = await this.getMoralisFeed().catch((e) => { failures++; this.logger.debug(e?.message || e); return null; });

      const merged = this.mergeFeeds([dex, bird, heli, moralis]);
      const deltas = await this.upsertFromMerged(merged);

      // Broadcast deltas
      if (deltas?.new?.length) deltas.new.forEach((d: any) => this.gateway.emitNew(d));
      if (deltas?.updated?.length) deltas.updated.forEach((d: any) => this.gateway.emitUpdate(d));

      apiCalls += (dex ? dex.__calls ?? 1 : 0) + (bird ? bird.__calls ?? 1 : 0) + (heli ? heli.__calls ?? 1 : 0) + (moralis ? moralis.__calls ?? 1 : 0);
      this.metrics.incCounter('listing_api_calls_total', apiCalls);
      this.metrics.incCounter('listing_refresh_total', 1);
      const total = (deltas?.new?.length ?? 0) + (deltas?.updated?.length ?? 0);
      this.logger.log(`Listings refreshed: ${total} (new: ${deltas?.new?.length ?? 0}, updated: ${deltas?.updated?.length ?? 0})`);
    } catch (e: any) {
      failures += 1;
      this.logger.warn(`Feed fetch failed: ${e.message}`);
      this.metrics.incCounter('listing_refresh_failures_total', 1);
    } finally {
      const duration = (Date.now() - started) / 1000;
      this.metrics.observeDuration('listing_refresh_duration_seconds', duration);
    }
  }

  private async getDexScreenerFeed() {
    const key = this.cache.cacheKey('feed:dex', { chains: 'all' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Fetch multiple search queries to scale results beyond 300 pairs.
    // Deduplicate by baseToken.address or pairAddress.
    const queries = [
      // Solana
      'sol', 'sol usdc', 'sol raydium', 'sol jupiter', 'sol pump', 'sol meme', 'sol pepe', 'sol doge', 'sol cat', 'sol dexscreener',
      // Ethereum
      'eth', 'ethereum uniswap', 'eth meme', 'eth pepe',
      // BSC
      'bsc', 'binance pancakeswap', 'bsc meme', 'bsc pepe',
      // Base
      'base', 'base uniswap', 'base meme',
      // Sui
      'sui', 'sui meme',
      // Aptos
      'aptos', 'aptos meme',
    ];

    const requests = queries.map((q) => {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
      return axios.get(url, { timeout: 8000 }).then(r => r.data).catch(() => ({ pairs: [] }));
    });

    const results = await Promise.all(requests);

    // Merge and dedupe pairs
    const byKey = new Map<string, any>();
    for (const res of results) {
      const pairs: any[] = Array.isArray(res?.pairs) ? res.pairs : [];
      for (const p of pairs) {
        const base = p?.baseToken || {};
        const address = base?.address || p?.pairAddress;
        if (!address) continue;
        const keyAddr = `${p?.chainId || 'unknown'}|${address}`;
        if (!byKey.has(keyAddr)) byKey.set(keyAddr, p);
      }
    }

    // Cap to ~600 raw pairs; actual upsert will slice to 350
    const merged = { pairs: Array.from(byKey.values()).slice(0, 600) };
    await this.cache.set(key, merged, 30);
    return { ...merged, __calls: results.length };
  }

  private async getBirdEyeFeed() {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) return null;
    const key = this.cache.cacheKey('feed:bird', { chain: 'solana' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Example endpoint: trending tokens (docs can vary by plan); fallback to top volume list
    const url = `https://public-api.birdeye.so/defi/v3/tokens/trending?chain=solana&sort_by=volume_h24&limit=100`;
    const { data } = await axios.get(url, { headers: { 'X-API-KEY': apiKey, 'accept': 'application/json' }, timeout: 8000 });
    await this.cache.set(key, data, 30);
    return { ...data, __calls: 1 };
  }

  //i added moralis too, for some reason i am finding it difficult yo get the birdeye public key
  private async getMoralisFeed() {
    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) return null;
 
    const key = this.cache.cacheKey('feed:moralis', { chain: 'solana' });
    const cached = await this.cache.get<any>(key);
    if (cached) return { ...cached, __calls: 0 };

    // Solana tokens by market cap
    const url = `https://deep-index.moralis.io/api/v2.2/market-data/solana/tokens?limit=100&sort=market_cap`;
    const { data } = await axios.get(url, {
      headers: { 'X-API-Key': apiKey, 'accept': 'application/json' },
      timeout: 8000,
    });

    // Normalize to match mergeFeeds shape
    const tokens = (data?.result ?? []).map((t: any) => ({
      address: t?.token_address,
      symbol: t?.symbol,
      name: t?.name,
      priceUsd: t?.price_usd ?? null,
      liquidityUsd: t?.liquidity_usd ?? null,
      fdv: t?.market_cap ?? null,
      volume24h: t?.volume_24h ?? null,
      holders: t?.holders ?? null,
      chain: 'solana',
      source: 'moralis',
    }));

    const wrapped = { data: { tokens } };
    await this.cache.set(key, wrapped, 30);
    return { ...wrapped, __calls: 1 };
  }


  private async getHeliusFeed() {
    const key = process.env.HELIUS_API_KEY;
    if (!key) return null;
    const cacheKey = this.cache.cacheKey('feed:helius', { chain: 'solana' });
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return { ...cached, __calls: 0 };

    // Heuristic: use DAS tokens API or enhanced tx activity to infer popular mints by high tx count
    // Here, we skip deep logic and return null if not configured strongly; placeholder for actual aggregation
    return null;
  }

  private isSolanaMint(addr: string | undefined | null): boolean {
    if (!addr) return false;
    if (addr.startsWith('0x')) return false; // EVM
    if (addr.includes('/') || addr.includes('.') || addr.includes(':')) return false; // cosmos/near paths
    const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58.test(addr);
  }

  private mapChainIdToEnum(chainId?: string): 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN' {
    const raw = (chainId || '').toLowerCase();
    if (!raw) return 'UNKNOWN';
    if (raw.includes('sol')) return 'SOLANA';
    if (raw.includes('ethereum') || raw === 'eth' || raw.includes('eth')) return 'ETHEREUM';
    if (raw.includes('bsc') || raw.includes('binance')) return 'BSC';
    if (raw.includes('base')) return 'BASE';
    if (raw.includes('sui')) return 'SUI';
    if (raw.includes('aptos')) return 'APTOS';
    if (raw.includes('near')) return 'NEAR';
    if (raw.includes('osmo') || raw.includes('osmosis')) return 'OSMOSIS';
    return 'OTHER';
  }

  // Resolve token/logo URL with caching to enrich listings lacking images
  private async resolveLogoCached(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
    symbol?: string | null,
    name?: string | null,
  ): Promise<string | null> {
    try {
      const cacheKey = this.cache.cacheKey('logo', { chain, address });
      const cached = await this.cache.get<string | null>(cacheKey);
      if (typeof cached !== 'undefined' && cached !== null) return cached;

      const url = await this.resolveLogoNetwork(chain, address, symbol, name);
      // Cache for 24h; also cache null as a sentinel to avoid repeated lookups
      await this.cache.set(cacheKey, url ?? null, 24 * 60 * 60);
      return url ?? null;
    } catch {
      return null;
    }
  }

  // Network strategy: Jupiter (Solana) -> TrustWallet -> deterministic identicon
  private async resolveLogoNetwork(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
    symbol?: string | null,
    name?: string | null,
  ): Promise<string | null> {
    const candidates: (string | null)[] = [];

    // 1) Jupiter verified tokens list for Solana
    if (chain === 'SOLANA') {
      const jup = await this.getJupiterLogo(address).catch(() => null);
      if (jup) return jup;
    }

    // 2) TrustWallet assets repo paths (no API key required)
    candidates.push(this.trustWalletPathForChain(chain, address));

    // 3) As a last resort, use a deterministic identicon (always available)
    const seed = encodeURIComponent(address || symbol || name || 'token');
    candidates.push(`https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`);

    for (const url of candidates) {
      if (!url) continue;
      const ok = await this.urlExists(url).catch(() => false);
      if (ok) return url;
    }
    return null;
  }

  private async getJupiterLogo(address: string): Promise<string | null> {
    const key = this.cache.cacheKey('jup:tokens', {});
    let tokens = await this.cache.get<any[]>(key);
    if (!Array.isArray(tokens) || tokens.length === 0) {
      try {
        // Prefer verified list; fallback to full list if needed
        const { data } = await axios.get('https://tokens.jup.ag/tokens?tags=verified', { timeout: 8000 });
        tokens = Array.isArray(data) ? data : [];
        if (tokens.length === 0) {
          const alt = await axios.get('https://tokens.jup.ag/tokens', { timeout: 8000 }).then(r => r.data).catch(() => []);
          tokens = Array.isArray(alt) ? alt : [];
        }
        // Cache for 12h
        await this.cache.set(key, tokens, 12 * 60 * 60);
      } catch {
        tokens = [];
      }
    }
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    const found = tokens.find((t: any) => (t?.address || t?.mint) === address);
    return found?.logoURI || null;
  }

  private trustWalletPathForChain(
    chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN',
    address: string,
  ): string | null {
    const base = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';
    const addr = address?.trim();
    if (!addr) return null;
    switch (chain) {
      case 'SOLANA':
        // SPL mint addresses are base58 and case-sensitive; TrustWallet uses exact mint path
        return `${base}/solana/assets/${addr}/logo.png`;
      case 'ETHEREUM':
        return `${base}/ethereum/assets/${addr}/logo.png`;
      case 'BSC':
        return `${base}/smartchain/assets/${addr}/logo.png`;
      case 'BASE':
        return `${base}/base/assets/${addr}/logo.png`;
      // Add more chains as needed when supported by TrustWallet repo
      default:
        return null;
    }
  }

  private async urlExists(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, { timeout: 2500, validateStatus: () => true });
      // GitHub raw returns 200 for present, 404 otherwise. Dicebear will return 200.
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  }

  private mergeFeeds(feeds: any[]) {
    const byKey = new Map<string, any>(); // key: chain|address

    for (const feed of feeds) {
      if (!feed) continue;

      // DexScreener shape: { pairs: [...] }
      if (Array.isArray(feed.pairs)) {
        for (const p of feed.pairs.slice(0, 400)) {
          const base = p?.baseToken || {};
          const address = base?.address || p?.pairAddress;
          const chainEnum = this.mapChainIdToEnum(p?.chainId);
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          // Prefer only valid numeric market fields and presence of txns
          const priceUsdNum = Number(p?.priceUsd ?? existing.market?.priceUsd);
          const liquidityUsdNum = Number(p?.liquidity?.usd ?? existing.market?.liquidityUsd);
          const volumeH24Num = Number(p?.volume?.h24 ?? existing.market?.volume?.h24);
          const txns = p?.txns ?? existing.market?.txns ?? null;
          const hasTx = !!(txns && (typeof txns?.h1?.buys === 'number' || typeof txns?.h1?.sells === 'number' || typeof txns?.h24?.buys === 'number' || typeof txns?.h24?.sells === 'number'));
          if (!Number.isFinite(priceUsdNum) || !Number.isFinite(liquidityUsdNum) || !Number.isFinite(volumeH24Num) || !hasTx) {
            continue;
          }
          const market = {
            priceUsd: priceUsdNum,
            liquidityUsd: liquidityUsdNum,
            fdv: Number.isFinite(Number(p?.fdv)) ? Number(p?.fdv) : (Number.isFinite(Number(existing.market?.fdv)) ? Number(existing.market?.fdv) : null),
            // DexScreener exposes priceChange as priceChange.h24 etc. when available
            priceChange: {
              h1: Number.isFinite(Number((p as any)?.priceChange?.h1)) ? Number((p as any)?.priceChange?.h1) : null,
              h6: Number.isFinite(Number((p as any)?.priceChange?.h6)) ? Number((p as any)?.priceChange?.h6) : null,
              h24: Number.isFinite(Number((p as any)?.priceChange?.h24)) ? Number((p as any)?.priceChange?.h24) : null,
            },
            volume: { h24: volumeH24Num },
            txns,
            pairAddress: p?.pairAddress ?? existing.market?.pairAddress ?? null,
            chainId: p?.chainId ?? null,
            source: 'dexscreener',
          };
          const logoUrl = p?.info?.imageUrl || base?.imageUrl || base?.logoURI || existing.logoUrl || null;
          byKey.set(key, { chain: chainEnum, address, symbol: base?.symbol, name: base?.name, market, logoUrl });
        }
      }

      // BirdEye shape (example): { data: { tokens: [...] }} or { data: [] }
      const birdTokens = feed?.data?.tokens || feed?.data || [];
      if (Array.isArray(birdTokens)) {
        for (const t of birdTokens.slice(0, 400)) {
          const address = t?.address || t?.mint || t?.tokenAddress;
          const chainEnum = this.mapChainIdToEnum(t?.chain || t?.chainId);
          if (!address) continue;
          if (chainEnum === 'SOLANA' && !this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          // Only include when required numeric fields are present
          const priceUsdNum = Number((t?.priceUsd ?? t?.price ?? existing.market?.priceUsd));
          const liquidityUsdNum = Number((t?.liquidity ?? existing.market?.liquidityUsd));
          const volumeH24Num = Number((t?.volume24h ?? t?.v24h ?? existing.market?.volume?.h24));
          if (!Number.isFinite(priceUsdNum) || !Number.isFinite(liquidityUsdNum) || !Number.isFinite(volumeH24Num)) {
            continue;
          }
          const market = {
            priceUsd: priceUsdNum,
            liquidityUsd: liquidityUsdNum,
            fdv: Number.isFinite(Number(t?.fdv)) ? Number(t?.fdv) : (Number.isFinite(Number(existing.market?.fdv)) ? Number(existing.market?.fdv) : null),
            // BirdEye sometimes exposes price change fields differently; keep placeholders
            priceChange: {
              h1: Number.isFinite(Number((t as any)?.priceChange1h)) ? Number((t as any)?.priceChange1h) : (existing.market?.priceChange?.h1 ?? null),
              h6: Number.isFinite(Number((t as any)?.priceChange6h)) ? Number((t as any)?.priceChange6h) : (existing.market?.priceChange?.h6 ?? null),
              h24: Number.isFinite(Number((t as any)?.priceChange24h)) ? Number((t as any)?.priceChange24h) : (existing.market?.priceChange?.h24 ?? null),
            },
            volume: { h24: volumeH24Num },
            chainId: t?.chain || t?.chainId || null,
            source: 'birdeye',
          };
          // Require txns to exist in the merged record. BirdEye doesn't provide txns, so only use it to enhance an existing DexScreener record with txns.
          if (!existing.market || !existing.market?.txns) {
            // No txns present → skip BirdEye-only entries per spec
            continue;
          }
          const merged = {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...existing.market, ...market, txns: existing.market.txns }, // preserve txns from DexScreener
            logoUrl: t?.logo || t?.logoURI || existing.logoUrl || null,
          };
          byKey.set(key, merged);
        }
      }

      // Moralis shape: { data: { tokens: [...] } }
      const moraTokens = feed?.data?.tokens || [];
      if (Array.isArray(moraTokens)) {
        for (const t of moraTokens.slice(0, 400)) {
          const address = t?.address;
          const chainEnum = 'SOLANA' as const;
          if (!address) continue;
          if (!this.isSolanaMint(address)) continue;

          const key = `${chainEnum}|${address}`;
          const existing = byKey.get(key) || {};
          const market = {
            priceUsd: Number(t?.priceUsd ?? existing.market?.priceUsd ?? 0),
            liquidityUsd: Number(t?.liquidityUsd ?? existing.market?.liquidityUsd ?? 0),
            fdv: Number(t?.fdv ?? existing.market?.fdv ?? 0),
            volume: { h24: Number(t?.volume24h ?? existing.market?.volume?.h24 ?? 0) },
            holders: t?.holders ?? existing.market?.holders ?? null,
            chainId: 'solana',
            source: 'moralis',
          } as any;
          byKey.set(key, {
            chain: chainEnum,
            address,
            symbol: t?.symbol ?? existing.symbol,
            name: t?.name ?? existing.name,
            market: { ...(existing.market || {}), ...market },
            logoUrl: existing.logoUrl ?? null,
          });
        }
      }
    }

    return Array.from(byKey.values());
  }

  private classifyCategory(x: { symbol?: string; name?: string; market?: any }): 'MEME' | 'DEFI' | 'NFT' | 'OTHER' | 'UNKNOWN' {
    const symbol = (x.symbol || '').toLowerCase();
    const name = (x.name || '').toLowerCase();
    const fdv = Number(x.market?.fdv ?? 0);
    const liq = Number(x.market?.liquidityUsd ?? 0);
    // Heuristics: small FDV, low liquidity, meme-ish names/symbols
    const memeHints = ['pepe', 'wojak', 'doge', 'bonk', 'elon', 'meme', 'cat', 'kitten', 'baby', 'moon', 'pump'];
    const hasMemeWord = memeHints.some((w) => symbol.includes(w) || name.includes(w));
    if (hasMemeWord || (fdv > 0 && fdv < 10_000_000 && liq > 0 && liq < 2_000_000)) return 'MEME';
    return 'OTHER';
  }

  private async upsertFromMerged(items: any[]) {
    const deltas = { new: [] as any[], updated: [] as any[] };
    if (!Array.isArray(items) || !items.length) return deltas;
    for (const x of items.slice(0, 350)) {
      const chain = x?.chain as 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' | 'UNKNOWN';
      const address = x?.address as string;
      if (!chain || !address) continue;
      if (chain === 'SOLANA' && !this.isSolanaMint(address)) continue;
      try {
        const category = this.classifyCategory(x);
        const before = await this.repo.findOne(address);
        // Enrich missing logo with TrustWallet assets or identicon (cached)
        const resolvedLogo = x.logoUrl || await this.resolveLogoCached(chain, address, x.symbol, x.name);
        await this.repo.upsertMarketMetadata({
          contractAddress: address,
          chain,
          symbol: x.symbol ?? null,
          name: x.name ?? null,
          market: { ...(x.market ?? {}), category, logoUrl: resolvedLogo ?? null },
        });
        const after = await this.repo.findOne(address);
        const m = (after as any)?.metadata?.market || {};
        const t = (after as any)?.metadata?.token || {};
        // Build payload to match frontend Listing shape where possible
        const payload = {
          id: after?.id ?? `${address}`,
          contractAddress: address,
          chain,
          symbol: after?.symbol ?? x.symbol ?? null,
          name: after?.name ?? x.name ?? null,
          category,
          priceUsd: after?.priceUsd ?? x.market?.priceUsd ?? null,
          change1h: (after as any)?.change1h ?? m?.priceChange?.h1 ?? null,
          change6h: (after as any)?.change6h ?? m?.priceChange?.h6 ?? null,
          change24h: (after as any)?.change24h ?? m?.priceChange?.h24 ?? null,
          liquidityUsd: after?.liquidityUsd ?? x.market?.liquidityUsd ?? null,
          marketCap: (after as any)?.marketCap ?? m?.fdv ?? m?.marketCap ?? null,
          volume24h: after?.volume24h ?? x.market?.volume?.h24 ?? x.market?.volume24h ?? null,
          holders: (after as any)?.holders ?? t?.holder_count ?? null,
          age: (after as any)?.age ?? t?.age_display_short ?? t?.age_display ?? null,
          communityScore: (after as any)?.communityScore ?? null,
          riskScore: after?.riskScore ?? null,
          txCount1h: (after?.txCount1h ?? (((x.market?.txns?.h1?.buys ?? 0) + (x.market?.txns?.h1?.sells ?? 0)))) ?? null,
          txCount24h: (after?.txCount24h ?? (((x.market?.txns?.h24?.buys ?? 0) + (x.market?.txns?.h24?.sells ?? 0)))) ?? null,
          logoUrl: x.logoUrl ?? m?.logoUrl ?? null,
          updatedAt: after?.updatedAt ?? new Date().toISOString(),
          createdAt: after?.createdAt ?? new Date().toISOString(),
        } as any;
        if (!before) deltas.new.push(payload);
        else deltas.updated.push(payload);
        this.metrics.incCounter(`listing_ingested_total{chain="${chain}"}`, 1);
      } catch (e: any) {
        this.logger.debug(`Upsert merged failed: ${e.message}`);
      }
    }
    return deltas;
  }

  private async upsertFromDexPairs(feed: any) {
    if (!feed) return;
    const pairs: any[] = Array.isArray(feed?.pairs) ? feed.pairs : [];
    const top = pairs.slice(0, 100); // cap to 100 per cycle

    for (const p of top) {
      try {
        // Dex pair schema fields of interest
        const token = p?.baseToken || {};
        const contractAddress = token?.address || p?.pairAddress || null;
        if (!contractAddress) continue;

        const market = {
          priceUsd: p?.priceUsd ?? null,
          liquidityUsd: p?.liquidity?.usd ?? null,
          fdv: p?.fdv ?? null,
          volume: {
            h24: p?.volume?.h24 ?? null,
            h6: p?.volume?.h6 ?? null,
            h1: p?.volume?.h1 ?? null,
          },
          txns: p?.txns ?? null,
          pairAddress: p?.pairAddress ?? null,
          chainId: p?.chainId ?? 'solana',
          dexId: p?.dexId ?? null,
        };

        const chain = this.mapChainIdToEnum(p?.chainId);
        await this.repo.upsertMarketMetadata({
          contractAddress,
          chain,
          symbol: token?.symbol ?? null,
          name: token?.name ?? null,
          market,
        });
      } catch (e: any) {
        this.logger.debug(`Upsert from dex failed: ${e.message}`);
      }
    }
  }

  // Phase 1 live updating: refresh all listings every 5 minutes using scan enrichment
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledRefreshAll() {
    const client = (this.repo as any)['prisma'] as any;
    const rows: { contractAddress: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' }[] = await client.listing.findMany({ select: { contractAddress: true, chain: true } });

    // Count per chain and total
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.chain] = (counts[r.chain] ?? 0) + 1;
    const total = rows.length;
    for (const [chain, count] of Object.entries(counts)) {
      this.metrics.incCounter(`listing_per_chain_total{chain="${chain}"}`, count);
    }

    // Only enqueue SOLANA listings for enrichment
    const solRows = rows.filter(r => r.chain === 'SOLANA');
    this.logger.log(`Solana listings queued: ${solRows.length} / Total listings: ${total}`);

    for (const { contractAddress } of solRows) {
      this.enqueue({ address: contractAddress, chain: 'SOLANA' });
    }
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    let refreshed = 0, apiCalls = 0, failures = 0;
    try {
      while (this.queue.length) {
        const item = this.queue.shift() as { address: string; chain: 'SOLANA' | 'ETHEREUM' | 'BSC' | 'SUI' | 'BASE' | 'APTOS' | 'NEAR' | 'OSMOSIS' | 'OTHER' } | string | undefined;
        if (!item) continue;
        const address = typeof item === 'string' ? item : item.address;
        const chain = typeof item === 'string' ? 'SOLANA' : item.chain;
        try {
          if (chain !== 'SOLANA') {
            // Skip enrichment for non-SOLANA for now
            await this.repo.persistScanAndUpsertListing({
              contractAddress: address,
              chain,
              token: null,
              riskScore: null,
              tier: null,
              summary: `${chain} enrichment not supported yet`,
            });
            continue;
          }

          const result = await this.scanService.scanToken(address, undefined, chain);
          apiCalls += 1;
          const { listing: updated } = await this.repo.persistScanAndUpsertListing({
            contractAddress: address,
            chain,
            token: result.metadata,
            riskScore: result.risk_score,
            tier: result.tier,
            summary: result.summary,
          });
          // Emit delta update for enrichment, include communityScore
          this.gateway.emitUpdate({ chain, contractAddress: address, tier: result.tier, riskScore: result.risk_score, communityScore: (updated as any)?.communityScore ?? null });
          refreshed += 1;
          this.logger.log(`Refreshed ${chain}:${address}`);
        } catch (e: any) {
          failures += 1;
          this.logger.warn(`Refresh failed for ${chain}:${address}: ${e.message}`);
        }
      }
    } finally {
      this.running = false;
      this.stats.cycles += 1;
      this.stats.refreshed += refreshed;
      this.stats.apiCalls += apiCalls;
      this.stats.failures += failures;
      this.stats.lastDurationMs = Date.now() - started;
      this.logger.log(`Refresh cycle complete: refreshed=${refreshed}, apiCalls=${apiCalls}, failures=${failures}, durationMs=${this.stats.lastDurationMs}`);
    }
  }
}