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
  private readonly panoraApiKey: string;
  private readonly indexerApiKey?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.fullnodeUrl =
      this.configService.get('APTOS_FULLNODE_URL') || 'https://api.mainnet.aptoslabs.com/v1';
    this.indexerUrl =
      this.configService.get('APTOS_INDEXER_URL') || 'https://indexer.mainnet.aptoslabs.com/v1/graphql';
    this.panoraBaseUrl =
      this.configService.get('PANORA_BASE_URL') || 'https://api.panora.exchange';
    this.panoraApiKey = this.configService.get('PANORA_API_KEY') || '';
    this.indexerApiKey = this.configService.get('APTOS_INDEXER_API_KEY') || undefined;

    const aptosNetwork = (this.configService.get('APTOS_NETWORK') || 'mainnet').toLowerCase();
    const config = new AptosConfig({
      network: aptosNetwork === 'mainnet' ? Network.MAINNET : Network.CUSTOM,
      fullnode: this.fullnodeUrl,
    });
    this.aptos = new Aptos(config);
  }

  async fetchTokenData(contractAddress: string) {
    const normalized = this.normalizeIdentifier(contractAddress);
    const panoraToken = await this.fetchPanoraToken(normalized);

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

    const onChainMeta = await this.fetchOnChainMetadata({ coinType, faAddress });
    const holders = await this.fetchHolderSnapshot({ coinType, faAddress, totalSupply: onChainMeta.totalSupply });

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

    const creationDate = this.pickDate(
      panoraToken?.createdAt,
      panoraToken?.created_at,
      panoraToken?.coinCreatedAt,
      panoraToken?.coin_created_at,
      panoraPrice?.createdAt,
      onChainMeta.creationTimestamp,
    );

    const liquidity = this.pickNumber(
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

    const volume24h = this.pickNumber(
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

    const price = this.pickNumber(
      panoraPrice?.price,
      panoraPrice?.priceUsd,
      panoraPrice?.price_usd,
      panoraPrice?.usdPrice,
      panoraToken?.price,
      panoraToken?.priceUsd,
      panoraToken?.usdPrice,
      0,
    );

    const marketCap = this.pickNumber(
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
      total_supply: this.pickNumber(panoraToken?.totalSupply, panoraToken?.total_supply, onChainMeta.totalSupply, 0),
      circulating_supply: this.pickNumber(
        panoraToken?.circulatingSupply,
        panoraToken?.circulating_supply,
        onChainMeta.circulatingSupply,
        onChainMeta.totalSupply,
        0,
      ),
      creation_date: creationDate,
      project_age_days: creationDate ? Math.max(0, Math.floor((Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24))) : 0,
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
        holderSource: holders.source,
        indexerUrl: this.indexerUrl,
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

    if (coinType) {
      const coinResult = await this.queryCoinHolders(coinType, totalSupply);
      if (coinResult) return coinResult;
    }

    if (faAddress) {
      const faResult = await this.queryFungibleAssetHolders(faAddress, totalSupply);
      if (faResult) return faResult;
    }

    return { count: 0, topHolders: [], source: 'unavailable' };
  }

  private async queryCoinHolders(coinType: string, totalSupply: number) {
    const query = `
      query CoinHolders($coinType: String!, $limit: Int!) {
        current_coin_balances(
          where: { coin_type: { _eq: $coinType } }
          order_by: { amount: desc }
          limit: $limit
        ) {
          owner_address
          amount
        }
      }
    `;

    return this.queryIndexerHolders(query, { coinType, limit: 10 }, totalSupply, 'coin');
  }

  private async queryFungibleAssetHolders(faAddress: string, totalSupply: number) {
    const queries = [
      {
        query: `
          query AssetHolders($assetType: String!, $limit: Int!) {
            current_unified_fungible_asset_balances(
              where: { asset_type: { _eq: $assetType } }
              order_by: { amount: desc }
              limit: $limit
            ) {
              owner_address
              amount
            }
          }
        `,
        variables: { assetType: faAddress, limit: 10 },
      },
      {
        query: `
          query AssetHoldersAlt($metadataAddress: String!, $limit: Int!) {
            current_fungible_asset_balances(
              where: { metadata_address: { _eq: $metadataAddress } }
              order_by: { amount: desc }
              limit: $limit
            ) {
              owner_address
              amount
            }
          }
        `,
        variables: { metadataAddress: faAddress, limit: 10 },
      },
      {
        query: `
          query AssetHoldersByAssetType($assetType: String!, $limit: Int!) {
            current_fungible_asset_balances(
              where: { asset_type: { _eq: $assetType } }
              order_by: { amount: desc }
              limit: $limit
            ) {
              owner_address
              amount
            }
          }
        `,
        variables: { assetType: faAddress, limit: 10 },
      },
    ];

    for (const item of queries) {
      const result = await this.queryIndexerHolders(item.query, item.variables, totalSupply, 'fungible_asset');
      if (result) return result;
    }

    return null;
  }

  private async queryIndexerHolders(
    query: string,
    variables: Record<string, any>,
    totalSupply: number,
    source: string,
  ): Promise<{ count: number; topHolders: HolderEntry[]; source: string } | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.indexerApiKey) {
        headers['Authorization'] = `Bearer ${this.indexerApiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.post(
          this.indexerUrl,
          { query, variables },
          {
            headers,
            timeout: 15000,
          },
        ),
      );

      if (response.data?.errors?.length) {
        this.logger.debug(`Indexer query failed for ${source}: ${JSON.stringify(response.data.errors)}`);
        return null;
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

      const count = aggregate || topHolders.length;
      // Treat empty results as unresolved so the caller can try fallback queries.
      if (!count && topHolders.length === 0) {
        return null;
      }

      return {
        count: aggregate || topHolders.length,
        topHolders,
        source,
      };
    } catch (error: any) {
      this.logger.debug(`Indexer holder query failed for ${source}: ${error.message}`);
      return null;
    }
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
}
