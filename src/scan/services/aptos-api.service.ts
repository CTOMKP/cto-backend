import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import {
  isAptosCoinType,
  normalizeAptosCoinType,
  normalizeAptosHexAddress,
} from '../../utils/validation';
import { AnalyticsService } from '../../listing/services/analytics.service';

type HolderEntry = {
  address: string;
  balance: number;
  percentage: number;
};

@Injectable()
export class AptosApiService {
  private readonly logger = new Logger(AptosApiService.name);
  private readonly aptos: Aptos;
  private readonly fullnodeUrl: string;
  private readonly indexerUrl: string;
  private readonly panoraBaseUrl: string;
  private readonly geckoTerminalBaseUrl: string;
  private readonly coingeckoBaseUrl: string;
  private readonly panoraApiKey: string;
  private readonly coingeckoApiKey: string;
  private readonly strictAptosDate: boolean;
  private readonly fullnodeApiKey?: string;
  private readonly indexerApiKey?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly analyticsService: AnalyticsService,
  ) {
    this.fullnodeUrl =
      this.configService.get('GEOMI_FULLNODE_URL') ||
      this.configService.get('APTOS_FULLNODE_URL') ||
      'https://api.mainnet.aptoslabs.com/v1';
    this.indexerUrl =
      this.configService.get('GEOMI_INDEXER_URL') ||
      this.configService.get('APTOS_INDEXER_URL') ||
      'https://api.mainnet.aptoslabs.com/v1/graphql';
    this.panoraBaseUrl =
      this.configService.get('PANORA_BASE_URL') || 'https://api.panora.exchange';
    this.geckoTerminalBaseUrl =
      this.configService.get('GECKOTERMINAL_BASE_URL') || 'https://api.geckoterminal.com/api/v2';
    this.coingeckoBaseUrl =
      this.configService.get('COINGECKO_BASE_URL') || 'https://api.coingecko.com/api/v3';
    this.panoraApiKey = this.configService.get('PANORA_API_KEY') || '';
    this.coingeckoApiKey = this.configService.get('COINGECKO_API_KEY') || '';
    this.strictAptosDate = this.parseBoolean(
      this.configService.get('APTOS_STRICT_DATE') ?? 'true',
      true,
    );
    this.fullnodeApiKey =
      this.configService.get('GEOMI_API_KEY') ||
      this.configService.get('APTOS_API_KEY') ||
      this.configService.get('APTOS_INDEXER_API_KEY') ||
      undefined;
    this.indexerApiKey =
      this.configService.get('APTOS_INDEXER_API_KEY') ||
      this.configService.get('GEOMI_API_KEY') ||
      this.configService.get('APTOS_API_KEY') ||
      undefined;

    const aptosNetwork = (this.configService.get('APTOS_NETWORK') || 'mainnet').toLowerCase();
    const config = new AptosConfig({
      network: aptosNetwork === 'mainnet' ? Network.MAINNET : Network.CUSTOM,
      fullnode: this.fullnodeUrl,
      clientConfig: this.fullnodeApiKey
        ? ({
            HEADERS: {
              Authorization: `Bearer ${this.fullnodeApiKey}`,
            },
          } as any)
        : undefined,
    });
    this.aptos = new Aptos(config);
  }

  async fetchTokenData(contractAddress: string) {
    const normalized = this.normalizeIdentifier(contractAddress);
    const panoraToken = await this.fetchPanoraToken(normalized);
    const coinGeckoId =
      this.pickString(
        panoraToken?.coinGeckoId,
        panoraToken?.coin_gecko_id,
        panoraToken?.coingeckoId,
        panoraToken?.coingecko_id,
      ) || null;

    const faAddress =
      this.pickString(
        panoraToken?.faAddress,
        panoraToken?.fa_address,
        panoraToken?.assetAddress,
        panoraToken?.asset_address,
        !isAptosCoinType(normalized) ? normalized : null,
      ) || null;

    const coinType =
      this.pickString(
        panoraToken?.tokenAddress,
        panoraToken?.token_address,
        panoraToken?.coinType,
        panoraToken?.coin_type,
        isAptosCoinType(normalized) ? normalized : null,
      ) || null;

    const panoraPrice = await this.fetchPanoraPriceCandidates(
      [normalized, faAddress, coinType].filter((v): v is string => !!v),
    );
    const geckoToken = await this.fetchGeckoTerminalTokenData(
      [faAddress, normalized, coinType].filter((v): v is string => !!v),
    );
    const geckoPoolStats = await this.fetchGeckoTerminalPoolStats(geckoToken?.topPoolIds || []);
    const coinGeckoMarket = await this.fetchCoinGeckoMarketData({
      coinGeckoId,
      identifiers: [faAddress, normalized, coinType].filter((v): v is string => !!v),
    });

    const onChainMeta = await this.fetchOnChainMetadata({ coinType, faAddress });
    const holderSupply = this.pickNumber(
      geckoToken?.totalSupplyRaw,
      onChainMeta.totalSupply,
      geckoToken?.totalSupplyNormalized,
      0,
    );
    let holders = await this.fetchHolderSnapshot({
      coinType,
      faAddress,
      totalSupply: holderSupply,
    });
    if (!holders.count) {
      const panoraHolders = this.pickNumber(
        panoraPrice?.holderCount,
        panoraPrice?.holder_count,
        panoraPrice?.holders,
        panoraPrice?.totalHolders,
        panoraPrice?.total_holders,
        panoraToken?.holderCount,
        panoraToken?.holder_count,
        panoraToken?.holders,
        panoraToken?.totalHolders,
        panoraToken?.total_holders,
        0,
      );
      if (panoraHolders > 0) {
        holders = {
          count: panoraHolders,
          topHolders: [],
          source: 'panora_token',
        };
      }
    }
    if (!holders.count) {
      const fallbackHolders = await this.fetchFallbackHolderCount([faAddress, coinType, normalized]);
      if (fallbackHolders && fallbackHolders > 0) {
        holders = {
          count: fallbackHolders,
          topHolders: [],
          source: 'coingecko_onchain',
        };
      }
    }

    const creatorAddress =
      this.pickString(
        panoraToken?.creatorAddress,
        panoraToken?.creator_address,
        panoraToken?.ownerAddress,
        panoraToken?.owner_address,
        coinType ? coinType.split('::')[0] : null,
      ) || null;

    const creatorBalancePct =
      creatorAddress && holders.topHolders.length
        ? holders.topHolders.find((holder) => holder.address.toLowerCase() === creatorAddress.toLowerCase())?.percentage || 0
        : 0;

    const canonicalDateCandidates = [
      { provider: 'aptos_fullnode', value: onChainMeta.creationTimestamp },
      { provider: 'panora_token', value: panoraToken?.coinCreatedAt },
      { provider: 'panora_token', value: panoraToken?.coin_created_at },
      { provider: 'panora_token', value: panoraToken?.createdAt },
      { provider: 'panora_token', value: panoraToken?.created_at },
    ];
    const estimatedDateCandidates = [
      { provider: 'panora_price', value: panoraPrice?.createdAt },
      { provider: 'coingecko_coin', value: coinGeckoMarket?.genesisDate },
      { provider: 'geckoterminal_pool', value: geckoPoolStats?.oldestPoolCreatedAt },
    ];
    const creationResolution = this.resolveDateWithSource(
      this.strictAptosDate
        ? canonicalDateCandidates
        : [...canonicalDateCandidates, ...estimatedDateCandidates],
    );
    const creationDate = creationResolution.value;

    let liquidity = this.pickNumber(
      panoraPrice?.liquidity,
      panoraPrice?.liquidityUsd,
      panoraPrice?.liquidity_usd,
      panoraPrice?.totalLiquidityUsd,
      panoraPrice?.total_liquidity_usd,
      panoraPrice?.tvlUsd,
      panoraPrice?.tvl_usd,
      panoraToken?.liquidity,
      panoraToken?.liquidityUsd,
      panoraToken?.liquidity_usd,
      0,
    );
    let liquiditySource = this.resolveProviderForNumber([
      {
        provider: 'panora_price',
        values: [
          panoraPrice?.liquidity,
          panoraPrice?.liquidityUsd,
          panoraPrice?.liquidity_usd,
          panoraPrice?.totalLiquidityUsd,
          panoraPrice?.total_liquidity_usd,
          panoraPrice?.tvlUsd,
          panoraPrice?.tvl_usd,
        ],
      },
      {
        provider: 'panora_token',
        values: [panoraToken?.liquidity, panoraToken?.liquidityUsd, panoraToken?.liquidity_usd],
      },
    ]);
    if (liquidity <= 0) {
      const geckoLiquidity = this.pickNumber(geckoToken?.totalReserveUsd, 0);
      if (geckoLiquidity > 0) {
        liquidity = geckoLiquidity;
        liquiditySource = 'geckoterminal_token';
      }
    }
    if (liquidity <= 0) {
      const geckoPoolLiquidity = this.pickNumber(geckoPoolStats?.totalReserveUsd, 0);
      if (geckoPoolLiquidity > 0) {
        liquidity = geckoPoolLiquidity;
        liquiditySource = 'geckoterminal_pool';
      }
    }

    let volume24h = this.pickNumber(
      panoraPrice?.volume24h,
      panoraPrice?.volume_24h,
      panoraPrice?.volume24hUsd,
      panoraPrice?.volume_24h_usd,
      panoraPrice?.volume24hUSD,
      panoraPrice?.volumeUSD24h,
      panoraToken?.volume24h,
      panoraToken?.volume_24h,
      0,
    );
    let volumeSource = this.resolveProviderForNumber([
      {
        provider: 'panora_price',
        values: [
          panoraPrice?.volume24h,
          panoraPrice?.volume_24h,
          panoraPrice?.volume24hUsd,
          panoraPrice?.volume_24h_usd,
          panoraPrice?.volume24hUSD,
          panoraPrice?.volumeUSD24h,
        ],
      },
      {
        provider: 'panora_token',
        values: [panoraToken?.volume24h, panoraToken?.volume_24h],
      },
    ]);
    if (volume24h <= 0) {
      const geckoVolume = this.pickNumber(geckoToken?.volume24hUsd, 0);
      if (geckoVolume > 0) {
        volume24h = geckoVolume;
        volumeSource = 'geckoterminal_token';
      }
    }
    if (volume24h <= 0) {
      const geckoPoolVolume = this.pickNumber(geckoPoolStats?.totalVolume24h, 0);
      if (geckoPoolVolume > 0) {
        volume24h = geckoPoolVolume;
        volumeSource = 'geckoterminal_pool';
      }
    }
    if (volume24h <= 0) {
      const coinGeckoVolume = this.pickNumber(coinGeckoMarket?.volume24hUsd, 0);
      if (coinGeckoVolume > 0) {
        volume24h = coinGeckoVolume;
        volumeSource = 'coingecko_market';
      }
    }

    let price = this.pickNumber(
      panoraPrice?.price,
      panoraPrice?.priceUsd,
      panoraPrice?.price_usd,
      panoraPrice?.usdPrice,
      panoraToken?.price,
      panoraToken?.priceUsd,
      panoraToken?.usdPrice,
      0,
    );
    let priceSource = this.resolveProviderForNumber([
      {
        provider: 'panora_price',
        values: [panoraPrice?.price, panoraPrice?.priceUsd, panoraPrice?.price_usd, panoraPrice?.usdPrice],
      },
      {
        provider: 'panora_token',
        values: [panoraToken?.price, panoraToken?.priceUsd, panoraToken?.usdPrice],
      },
    ]);
    if (price <= 0) {
      const geckoPrice = this.pickNumber(geckoToken?.priceUsd, 0);
      if (geckoPrice > 0) {
        price = geckoPrice;
        priceSource = 'geckoterminal_token';
      }
    }
    if (price <= 0) {
      const coinGeckoPrice = this.pickNumber(coinGeckoMarket?.priceUsd, 0);
      if (coinGeckoPrice > 0) {
        price = coinGeckoPrice;
        priceSource = 'coingecko_market';
      }
    }

    let marketCap = this.pickNumber(
      panoraPrice?.marketCap,
      panoraPrice?.market_cap,
      panoraPrice?.fdv,
      panoraPrice?.fdvUsd,
      panoraPrice?.fdv_usd,
      panoraPrice?.marketCapUsd,
      panoraPrice?.market_cap_usd,
      panoraToken?.marketCap,
      panoraToken?.market_cap,
      onChainMeta.totalSupply && price ? onChainMeta.totalSupply * price : 0,
    );
    let marketCapSource = this.resolveProviderForNumber([
      {
        provider: 'panora_price',
        values: [
          panoraPrice?.marketCap,
          panoraPrice?.market_cap,
          panoraPrice?.fdv,
          panoraPrice?.fdvUsd,
          panoraPrice?.fdv_usd,
          panoraPrice?.marketCapUsd,
          panoraPrice?.market_cap_usd,
        ],
      },
      {
        provider: 'panora_token',
        values: [panoraToken?.marketCap, panoraToken?.market_cap],
      },
    ]);
    if (marketCapSource === 'unavailable' && marketCap > 0 && onChainMeta.totalSupply > 0 && price > 0) {
      marketCapSource = 'derived_supply_x_price';
    }
    if (marketCapSource === 'derived_supply_x_price') {
      const geckoFdv = this.pickNumber(geckoToken?.fdvUsd, geckoToken?.marketCapUsd, 0);
      if (geckoFdv > 0) {
        marketCap = geckoFdv;
        marketCapSource = 'geckoterminal_token';
      }
    }
    if (marketCap <= 0 || marketCapSource === 'derived_supply_x_price') {
      const coinGeckoCap = this.pickNumber(coinGeckoMarket?.marketCapUsd, 0);
      if (coinGeckoCap > 0) {
        marketCap = coinGeckoCap;
        marketCapSource = 'coingecko_market';
      }
    }

    const panoraTags = this.parseTags(panoraToken);
    const imageUrl =
      this.pickString(
        panoraToken?.logoURI,
        panoraToken?.logo_url,
        panoraToken?.iconUrl,
        panoraToken?.icon_url,
        onChainMeta.icon,
      ) || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(normalized)}`;

    const top10HolderRate = holders.topHolders.slice(0, 10).reduce((sum, holder) => sum + holder.percentage, 0) / 100;

    const projectAgeDays = creationDate
      ? Math.max(0, Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    const fieldProvenance = {
      holders: {
        provider: holders.source,
        status: holders.count > 0 ? 'resolved' : 'unavailable',
        value: holders.count,
      },
      liquidity: {
        provider: liquiditySource,
        status: liquidity > 0 ? 'resolved' : 'unavailable',
        value: liquidity,
      },
      volume24h: {
        provider: volumeSource,
        status: volume24h > 0 ? 'resolved' : 'unavailable',
        value: volume24h,
      },
      tokenAge: {
        provider: creationResolution.source,
        status: projectAgeDays !== null ? 'resolved' : 'unavailable',
        value: projectAgeDays,
      },
      price: {
        provider: priceSource,
        status: price > 0 ? 'resolved' : 'unavailable',
        value: price,
      },
      marketCap: {
        provider: marketCapSource,
        status: marketCap > 0 ? 'resolved' : 'unavailable',
        value: marketCap,
      },
    };

    return {
      identifier: normalized,
      asset_type: faAddress ? 'fungible_asset' : 'coin',
      token_type: coinType,
      fa_address: faAddress,
      name: this.pickString(panoraToken?.name, onChainMeta.name, 'Unknown Aptos Token'),
      symbol: this.pickString(panoraToken?.symbol, onChainMeta.symbol, 'UNKNOWN'),
      description: this.pickString(panoraToken?.description, onChainMeta.description, null),
      image: imageUrl,
      icon: imageUrl,
      decimals: this.pickNumber(panoraToken?.decimals, onChainMeta.decimals, 8),
      total_supply: this.pickNumber(
        panoraToken?.totalSupply,
        panoraToken?.total_supply,
        onChainMeta.totalSupply,
        geckoToken?.totalSupplyRaw,
        geckoToken?.totalSupplyNormalized,
        0,
      ),
      circulating_supply: this.pickNumber(
        panoraToken?.circulatingSupply,
        panoraToken?.circulating_supply,
        onChainMeta.circulatingSupply,
        geckoToken?.totalSupplyRaw,
        geckoToken?.totalSupplyNormalized,
        onChainMeta.totalSupply,
        0,
      ),
      creation_date: creationDate,
      project_age_days: projectAgeDays,
      holder_count: holders.count,
      total_holders: holders.count,
      top_holders: holders.topHolders.map((holder) => ({
        address: holder.address,
        amount: holder.balance,
        share: holder.percentage,
      })),
      token_price: price,
      volume_24h: volume24h,
      market_cap: marketCap,
      lp_amount_usd: liquidity,
      pool_count: this.pickNumber(panoraPrice?.poolCount, panoraToken?.poolCount, 1),
      lp_locked: false,
      lp_burned: false,
      lp_lock_months: 0,
      mint_authority: null,
      freeze_authority: null,
      verified: panoraTags.some((tag) => tag.toLowerCase() === 'recognized'),
      panora_tags: panoraTags,
      websites: this.collectStrings(
        panoraToken?.websiteUrl,
        panoraToken?.website_url,
        panoraToken?.website,
      ),
      socials: this.collectStrings(
        panoraToken?.twitter,
        panoraToken?.twitterUrl,
        panoraToken?.telegram,
        panoraToken?.discord,
      ),
      creator_address: creatorAddress,
      creator_balance_pct: creatorBalancePct,
      top10_holder_rate: top10HolderRate,
      source: {
        panoraTokenResolved: !!panoraToken,
        panoraPriceResolved: !!panoraPrice,
        geckoPoolResolved: !!geckoPoolStats,
        coingeckoResolved: !!coinGeckoMarket,
        strictAptosDate: this.strictAptosDate,
        holderSource: holders.source,
        indexerUrl: this.indexerUrl,
        fieldProvenance,
      },
    };
  }

  private normalizeIdentifier(identifier: string): string {
    const trimmed = identifier.trim();
    if (isAptosCoinType(trimmed)) {
      return normalizeAptosCoinType(trimmed)!;
    }
    const normalizedHex = normalizeAptosHexAddress(trimmed);
    if (normalizedHex) {
      return normalizedHex;
    }
    return trimmed;
  }

  private async fetchPanoraToken(identifier: string): Promise<any | null> {
    const endpoints = [
      `/tokenlist?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
      `/token-list?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
      `/tokens?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
    ];

    for (const endpoint of endpoints) {
      const data = await this.panoraGet(endpoint);
      const item = this.unwrapFirstItem(data);
      if (item) return item;
    }

    this.logger.warn(`Panora token metadata not found for ${identifier}`);
    return null;
  }

  private async fetchPanoraPrice(identifier: string): Promise<any | null> {
    const endpoints = [
      `/prices?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
      `/token-prices?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
      `/price?chainId=1&tokenAddress=${encodeURIComponent(identifier)}`,
    ];

    for (const endpoint of endpoints) {
      const data = await this.panoraGet(endpoint);
      const item = this.unwrapFirstItem(data) || this.unwrapObject(data);
      if (item) return item;
    }

    this.logger.warn(`Panora token price not found for ${identifier}`);
    return null;
  }

  private async fetchPanoraPriceCandidates(identifiers: string[]): Promise<any | null> {
    for (const identifier of identifiers) {
      const price = await this.fetchPanoraPrice(identifier);
      if (price) {
        return price;
      }
    }
    return null;
  }

  private async fetchGeckoTerminalTokenData(identifiers: string[]) {
    for (const identifier of identifiers) {
      // GeckoTerminal Aptos token endpoint expects a hex token/metadata address, not coin-type format.
      if (!normalizeAptosHexAddress(identifier)) {
        continue;
      }

      const data = await this.geckoGet(`/networks/aptos/tokens/${encodeURIComponent(identifier)}`);
      const attrs = data?.data?.attributes;
      if (attrs) {
        const topPoolIds = Array.isArray(data?.data?.relationships?.top_pools?.data)
          ? data.data.relationships.top_pools.data
              .map((pool: any) => this.pickString(pool?.id))
              .filter((value: string | null): value is string => !!value)
          : [];
        return {
          priceUsd: this.pickNumber(attrs.price_usd, 0),
          fdvUsd: this.pickNumber(attrs.fdv_usd, 0),
          marketCapUsd: this.pickNumber(attrs.market_cap_usd, 0),
          totalReserveUsd: this.pickNumber(attrs.total_reserve_in_usd, 0),
          volume24hUsd: this.pickNumber(attrs.volume_usd?.h24, 0),
          totalSupplyRaw: this.pickNumber(attrs.total_supply, 0),
          totalSupplyNormalized: this.pickNumber(attrs.normalized_total_supply, 0),
          topPoolIds,
        };
      }
    }

    return null;
  }

  private async fetchGeckoTerminalPoolStats(poolIds: string[]) {
    if (!Array.isArray(poolIds) || poolIds.length === 0) {
      return null;
    }

    const uniquePoolIds = [...new Set(poolIds)].slice(0, 5);
    let totalVolume24h = 0;
    let totalReserveUsd = 0;
    let oldestPoolCreatedAt: Date | null = null;
    let resolved = false;

    for (const poolId of uniquePoolIds) {
      const poolAddress = poolId.startsWith('aptos_') ? poolId.slice('aptos_'.length) : poolId;
      const poolCandidates = [...new Set([poolAddress, poolId].filter(Boolean))];
      let attrs: any = null;

      for (const candidate of poolCandidates) {
        const data = await this.geckoGet(`/networks/aptos/pools/${encodeURIComponent(candidate)}`);
        attrs = data?.data?.attributes;
        if (attrs) break;
      }

      if (!attrs) continue;

      resolved = true;
      totalVolume24h += this.pickNumber(attrs.volume_usd?.h24, 0);
      totalReserveUsd += this.pickNumber(attrs.reserve_in_usd, attrs.total_reserve_in_usd, 0);

      const poolCreatedAt = this.pickDate(
        attrs.pool_created_at,
        attrs.created_at,
        attrs.first_created_at,
        attrs.createdAt,
      );
      if (poolCreatedAt && (!oldestPoolCreatedAt || poolCreatedAt < oldestPoolCreatedAt)) {
        oldestPoolCreatedAt = poolCreatedAt;
      }
    }

    if (!resolved) {
      return null;
    }

    return {
      totalVolume24h,
      totalReserveUsd,
      oldestPoolCreatedAt,
    };
  }

  private async fetchCoinGeckoMarketData(params: {
    coinGeckoId: string | null;
    identifiers: string[];
  }) {
    const { coinGeckoId, identifiers } = params;

    if (coinGeckoId) {
      const marketById = await this.fetchCoinGeckoById(coinGeckoId);
      if (marketById) {
        return marketById;
      }
    }

    const uniqueIdentifiers = [...new Set(identifiers)];
    for (const identifier of uniqueIdentifiers) {
      const marketByAddress = await this.fetchCoinGeckoSimpleByAddress(identifier);
      if (marketByAddress) {
        return marketByAddress;
      }
    }

    return null;
  }

  private async fetchCoinGeckoById(coinGeckoId: string) {
    const data = await this.coingeckoGet(
      `/coins/${encodeURIComponent(
        coinGeckoId,
      )}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
    );
    if (!data) {
      return null;
    }

    const marketData = data.market_data || {};
    return {
      priceUsd: this.pickNumber(marketData?.current_price?.usd, 0),
      marketCapUsd: this.pickNumber(marketData?.market_cap?.usd, 0),
      volume24hUsd: this.pickNumber(marketData?.total_volume?.usd, 0),
      genesisDate: this.pickDate(data?.genesis_date, marketData?.atl_date?.usd),
    };
  }

  private async fetchCoinGeckoSimpleByAddress(identifier: string) {
    if (!normalizeAptosHexAddress(identifier)) {
      return null;
    }

    const data = await this.coingeckoGet(
      `/simple/token_price/aptos?contract_addresses=${encodeURIComponent(
        identifier,
      )}&vs_currencies=usd&include_24hr_vol=true&include_market_cap=true`,
    );
    if (!data || typeof data !== 'object') {
      return null;
    }

    const firstKey = Object.keys(data)[0];
    const tokenData = firstKey ? data[firstKey] : null;
    if (!tokenData || typeof tokenData !== 'object') {
      return null;
    }

    const priceUsd = this.pickNumber(tokenData?.usd, 0);
    const marketCapUsd = this.pickNumber(tokenData?.usd_market_cap, 0);
    const volume24hUsd = this.pickNumber(tokenData?.usd_24h_vol, 0);

    if (priceUsd <= 0 && marketCapUsd <= 0 && volume24hUsd <= 0) {
      return null;
    }

    return {
      priceUsd,
      marketCapUsd,
      volume24hUsd,
      genesisDate: null,
    };
  }

  private async panoraGet(path: string): Promise<any | null> {
    if (!this.panoraApiKey) {
      this.logger.warn('PANORA_API_KEY not configured, skipping Panora fetch');
      return null;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.panoraBaseUrl}${path}`, {
          headers: {
            'x-api-key': this.panoraApiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.debug(`Panora request failed for ${path}: ${error.message}`);
      return null;
    }
  }

  private async geckoGet(path: string): Promise<any | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.geckoTerminalBaseUrl}${path}`, {
          headers: {
            Accept: 'application/json',
          },
          timeout: 15000,
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.debug(`GeckoTerminal request failed for ${path}: ${error.message}`);
      return null;
    }
  }

  private async coingeckoGet(path: string): Promise<any | null> {
    const requestWithHeaders = async (headers: Record<string, string>) =>
      firstValueFrom(
        this.httpService.get(`${this.coingeckoBaseUrl}${path}`, {
          headers,
          timeout: 15000,
        }),
      );

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.coingeckoApiKey) {
        if (this.coingeckoApiKey.startsWith('CG-')) {
          headers['x-cg-demo-api-key'] = this.coingeckoApiKey;
        } else {
          headers['x-cg-pro-api-key'] = this.coingeckoApiKey;
        }
      }

      const response = await requestWithHeaders(headers);
      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      if (this.coingeckoApiKey && [400, 401, 403].includes(status)) {
        try {
          const fallback = await requestWithHeaders({ Accept: 'application/json' });
          return fallback.data;
        } catch {
          // continue to debug log below
        }
      }
      this.logger.debug(`CoinGecko request failed for ${path}: status=${status ?? 'n/a'} ${error.message}`);
      return null;
    }
  }

  private unwrapFirstItem(data: any): any | null {
    if (!data) return null;
    if (Array.isArray(data) && data.length) return data[0];
    if (Array.isArray(data?.data) && data.data.length) return data.data[0];
    if (Array.isArray(data?.tokens) && data.tokens.length) return data.tokens[0];
    if (Array.isArray(data?.result) && data.result.length) return data.result[0];
    return null;
  }

  private unwrapObject(data: any): any | null {
    if (!data) return null;
    if (Array.isArray(data)) return data[0] || null;
    if (typeof data === 'object') {
      if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
      return data;
    }
    return null;
  }

  private async fetchOnChainMetadata(params: { coinType: string | null; faAddress: string | null }) {
    const { coinType, faAddress } = params;
    let name: string | null = null;
    let symbol: string | null = null;
    let icon: string | null = null;
    let description: string | null = null;
    let decimals: number | null = null;
    let totalSupply = 0;
    let circulatingSupply = 0;
    let creationTimestamp: Date | null = null;

    if (faAddress) {
      try {
        const fa = await this.aptos.getFungibleAssetMetadata({
          fungibleAssetMetadataAddress: faAddress as `0x${string}`,
        } as any);

        name = this.pickString((fa as any)?.name, name);
        symbol = this.pickString((fa as any)?.symbol, symbol);
        icon = this.pickString((fa as any)?.icon_uri, (fa as any)?.iconUri, icon);
        decimals = this.pickNumber((fa as any)?.decimals, decimals);
        totalSupply = this.pickNumber((fa as any)?.supply, totalSupply);
        circulatingSupply = this.pickNumber((fa as any)?.supply, circulatingSupply);
      } catch (error: any) {
        this.logger.debug(`Aptos FA metadata fetch failed for ${faAddress}: ${error.message}`);
      }
    }

    if (coinType) {
      try {
        const creatorAddress = coinType.split('::')[0];
        const response = await firstValueFrom(
          this.httpService.get(`${this.fullnodeUrl}/accounts/${creatorAddress}/resource/${encodeURIComponent(`0x1::coin::CoinInfo<${coinType}>`)}`, {
            headers: this.getFullnodeHeaders(),
            timeout: 15000,
          }),
        );
        const data = response.data?.data || {};
        name = this.pickString(data?.name, name);
        symbol = this.pickString(data?.symbol, symbol);
        decimals = this.pickNumber(data?.decimals, decimals);
        const supply = this.pickNumber(data?.supply?.vec?.[0]?.integer?.vec?.[0]?.value, totalSupply);
        totalSupply = supply;
        circulatingSupply = this.pickNumber(circulatingSupply, supply);
      } catch (error: any) {
        this.logger.debug(`Aptos CoinInfo fetch failed for ${coinType}: ${error.message}`);
      }
    }

    return {
      name,
      symbol,
      icon,
      description,
      decimals: decimals ?? 8,
      totalSupply,
      circulatingSupply,
      creationTimestamp,
    };
  }

  private async fetchHolderSnapshot(params: {
    coinType: string | null;
    faAddress: string | null;
    totalSupply: number;
  }): Promise<{ count: number; topHolders: HolderEntry[]; source: string }> {
    const { coinType, faAddress, totalSupply } = params;
    const candidates = [faAddress, coinType].filter((value): value is string => !!value);

    for (const candidate of candidates) {
      const holderResult = await this.queryFungibleAssetHolders(candidate, totalSupply);
      if (holderResult) {
        return holderResult;
      }
    }

    return { count: 0, topHolders: [], source: 'unavailable' };
  }

  private async queryFungibleAssetHolders(identifier: string, totalSupply: number) {
    const query = `
      query AssetHoldersByAssetType($assetType: String!, $limit: Int!) {
        current_fungible_asset_balances(
          where: { asset_type: { _eq: $assetType } }
          order_by: { amount: desc }
          limit: $limit
        ) {
          owner_address
          amount
        }
        current_fungible_asset_balances_aggregate(
          where: { asset_type: { _eq: $assetType } }
        ) {
          aggregate {
            count
          }
        }
      }
    `;

    return this.queryIndexerHolders(
      query,
      { assetType: identifier, limit: 10 },
      totalSupply,
      `fungible_asset:${identifier}`,
    );
  }

  private async queryIndexerHolders(
    query: string,
    variables: Record<string, any>,
    totalSupply: number,
    source: string,
  ): Promise<{ count: number; topHolders: HolderEntry[]; source: string } | null> {
    const request = async (timeout: number) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.indexerApiKey) {
        headers['Authorization'] = `Bearer ${this.indexerApiKey}`;
      }
      return firstValueFrom(
        this.httpService.post(
          this.indexerUrl,
          { query, variables },
          {
            headers,
            timeout,
          },
        ),
      );
    };

    for (const timeout of [10000, 15000]) {
      try {
        const response = await request(timeout);

        if (response.data?.errors?.length) {
          this.logger.debug(`Indexer query failed for ${source}: ${JSON.stringify(response.data.errors)}`);
          continue;
        }

        const data = response.data?.data || {};
        const rows = this.extractFirstArray(data);
        const aggregate = this.extractAggregateCount(data);

        const topHolders = (rows || [])
          .map((row: any) => {
            const amount = Number(row.amount || 0);
            return {
              address: row.owner_address || row.ownerAddress || '',
              balance: amount,
              percentage: totalSupply > 0 ? (amount / totalSupply) * 100 : 0,
            };
          })
          .filter((holder: HolderEntry) => holder.balance > 0 && holder.address);

        const top1Pct = topHolders[0]?.percentage || 0;
        const top10Pct = topHolders.slice(0, 10).reduce((sum, holder) => sum + holder.percentage, 0);
        if (top1Pct > 100 || top10Pct > 100) {
          this.logger.warn(
            `Discarding invalid Aptos holder distribution from ${source}: top1=${top1Pct.toFixed(
              2,
            )}%, top10=${top10Pct.toFixed(2)}%`,
          );
          topHolders.length = 0;
        }

        const count = aggregate || topHolders.length;
        if (!count && topHolders.length === 0) {
          continue;
        }

        return {
          count: aggregate || topHolders.length,
          topHolders,
          source,
        };
      } catch (error: any) {
        this.logger.debug(`Indexer holder query failed for ${source} (timeout=${timeout}): ${error.message}`);
      }
    }

    const aggregateOnly = await this.queryIndexerHolderCountOnly(String(variables?.assetType || ''), source);
    if (aggregateOnly > 0) {
      return {
        count: aggregateOnly,
        topHolders: [],
        source: `${source}:aggregate_only`,
      };
    }

    return null;
  }

  private async queryIndexerHolderCountOnly(assetType: string, source: string): Promise<number> {
    if (!assetType) return 0;

    const query = `
      query AssetHolderCountOnly($assetType: String!) {
        current_fungible_asset_balances_aggregate(
          where: { asset_type: { _eq: $assetType } }
        ) {
          aggregate {
            count
          }
        }
      }
    `;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.indexerApiKey) {
      headers['Authorization'] = `Bearer ${this.indexerApiKey}`;
    }

    for (const timeout of [8000, 12000]) {
      try {
        const response = await firstValueFrom(
          this.httpService.post(
            this.indexerUrl,
            { query, variables: { assetType } },
            {
              headers,
              timeout,
            },
          ),
        );
        if (response.data?.errors?.length) {
          this.logger.debug(
            `Indexer aggregate-only query failed for ${source}: ${JSON.stringify(response.data.errors)}`,
          );
          continue;
        }
        const count = this.extractAggregateCount(response.data?.data || {});
        if (count > 0) {
          return count;
        }
      } catch (error: any) {
        this.logger.debug(
          `Indexer aggregate-only holder query failed for ${source} (timeout=${timeout}): ${error.message}`,
        );
      }
    }

    return 0;
  }

  private async fetchFallbackHolderCount(candidates: Array<string | null>) {
    const unique = [...new Set(candidates.filter((value): value is string => !!value))];

    for (const candidate of unique) {
      try {
        const holders = await this.analyticsService.getHolderCount(candidate, 'APTOS');
        if (holders && holders > 0) {
          this.logger.debug(`Aptos holder fallback resolved ${holders} holders for ${candidate}`);
          return holders;
        }
      } catch (error: any) {
        this.logger.debug(`Aptos holder fallback failed for ${candidate}: ${error.message}`);
      }
    }

    return 0;
  }

  private extractFirstArray(data: Record<string, any>): any[] {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  private extractAggregateCount(data: Record<string, any>): number {
    for (const value of Object.values(data)) {
      const count = value?.aggregate?.count;
      if (typeof count === 'number') return count;
    }
    return 0;
  }

  private parseTags(token: any): string[] {
    const raw = token?.panoraTags || token?.panora_tags || token?.tags || [];
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  private collectStrings(...values: any[]): string[] {
    return values
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim());
  }

  private pickString(...values: any[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return null;
  }

  private pickNumber(...values: any[]): number {
    for (const value of values) {
      const num = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(num)) return num;
    }
    return 0;
  }

  private pickDate(...values: any[]): Date | null {
    for (const value of values) {
      if (!value) continue;
      const date = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  private resolveDateWithSource(
    candidates: Array<{ provider: string; value: any }>,
  ): { value: Date | null; source: string } {
    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const date = candidate.value instanceof Date ? candidate.value : new Date(candidate.value);
      if (!Number.isNaN(date.getTime())) {
        return { value: date, source: candidate.provider };
      }
    }
    return { value: null, source: 'unavailable' };
  }

  private resolveProviderForNumber(
    candidates: Array<{ provider: string; values: any[] }>,
  ): string {
    for (const candidate of candidates) {
      for (const value of candidate.values) {
        const num = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(num)) {
          return candidate.provider;
        }
      }
    }
    return 'unavailable';
  }

  private getFullnodeHeaders() {
    if (!this.fullnodeApiKey) {
      return undefined;
    }
    return {
      Authorization: `Bearer ${this.fullnodeApiKey}`,
    };
  }

  private parseBoolean(value: string | boolean, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
  }
}
