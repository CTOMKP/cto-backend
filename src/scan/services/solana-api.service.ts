import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { createSafeFetcher } from '../../utils/safe-fetcher';

@Injectable()
export class SolanaApiService {
  private readonly logger = new Logger(SolanaApiService.name);
  // API Configuration - Using Solana Mainnet for production-ready token analysis
  private readonly HELIUS_RPC_URL: string;
  private readonly SOLANA_SCAN_RPC_URL: string;
  private readonly SOLSCAN_API_URL = 'https://public-api.solscan.io';
  private readonly RAYDIUM_API_URL = 'https://api.raydium.io/v2/sdk/liquidity/mainnet.json';
  private readonly RUGCHECK_API_URL = 'https://api.rugcheck.xyz/v1/tokens';
  private readonly MORALIS_API_URL = 'https://deep-index.moralis.io/api/v2.2';

  // Safe Fetchers
  private helius: AxiosInstance;
  private moralis: AxiosInstance;
  private solscan: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const heliusApiKey = this.configService.get<string>('HELIUS_API_KEY')?.trim();
    const moralisApiKey = this.configService.get<string>('MORALIS_API_KEY')?.trim();
    const solscanApiKey = this.configService.get<string>('SOLSCAN_API_KEY')?.trim();

    this.HELIUS_RPC_URL = heliusApiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`
      : 'https://api.mainnet-beta.solana.com';
    // Scanner must always read Solana mainnet token history, independent of faucet/runtime RPC.
    this.SOLANA_SCAN_RPC_URL = this.configService.get(
      'SOLANA_SCAN_RPC_URL',
      this.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com',
    );
    
    // Helius free/low tiers work best with key in URL, not header
    this.helius = axios.create({
      baseURL: this.HELIUS_RPC_URL,
      timeout: 15000,
    });

    this.moralis = createSafeFetcher('https://solana-gateway.moralis.io/token/mainnet/', moralisApiKey, 'X-API-Key');
    
    // Solscan V2 Pro keys (JWT) require 'x-api-key', Old V1 keys require 'token'
    const isV2 = solscanApiKey?.startsWith('eyJ');
    this.solscan = createSafeFetcher(
      isV2 ? 'https://pro-api.solscan.io/v2/' : 'https://api.solscan.io/',
      solscanApiKey,
      isV2 ? 'x-api-key' : 'token'
    );
  }

  /**
   * Fetches comprehensive token data from Solana APIs
   */
  async fetchTokenData(contractAddress: string) {
    try {
      console.log(`Fetching token data for: ${contractAddress}`);
      
      const [tokenInfo, holderData, liquidityData, moralisData] = await Promise.all([
        this.fetchTokenInfo(contractAddress),
        this.fetchHolderData(contractAddress),
        this.fetchLiquidityData(contractAddress),
        this.fetchMoralisMarket(contractAddress),
      ]);

      // Mint age must come from mint history. Pool creation is stored separately and
      // must never be presented as the token's creation time.
      const rpcCreationDate = tokenInfo.creation_date || null;
      const dexPairCreationDate = liquidityData.pair_created_at || null;
      const creationDate = rpcCreationDate;
      const projectAgeDays = creationDate
        ? (Date.now() - creationDate.getTime()) / (1000 * 60 * 60 * 24)
        : null;

      // Prefer Moralis market/price data when available
      const tokenPrice = moralisData?.price_usd ?? liquidityData.price;
      const marketCap = moralisData?.market_cap_usd ?? liquidityData.market_cap ?? null;
      const volume24h = moralisData?.volume_24h_usd ?? liquidityData.volume_24h ?? null;

      return {
        symbol: tokenInfo.symbol || 'UNKNOWN',
        name: tokenInfo.name || 'Unknown Token',
        mint_authority: tokenInfo.mint_authority,
        freeze_authority: tokenInfo.freeze_authority,
        creation_date: creationDate,
        first_pool_created_at: dexPairCreationDate,
        project_age_days: Number.isFinite(projectAgeDays as number)
          ? Math.max(0, projectAgeDays as number)
          : null,
        total_supply: tokenInfo.total_supply,
        decimals: tokenInfo.decimals,
        authority_data_status: tokenInfo.authority_data_status,
        age_data_status: creationDate ? 'observed' : 'unknown',
        data_sources: tokenInfo.data_sources || null,
        
        // Liquidity / market data
        lp_amount_usd: liquidityData.lp_amount_usd ?? null,
        lp_lock_months: liquidityData.lp_lock_months ?? null,
        lp_burned: liquidityData.lp_burned ?? null,
        lp_locked: liquidityData.lp_locked ?? null,
        lp_lock_data_status: liquidityData.lp_lock_data_status || 'unknown',
        lock_contract: liquidityData.lock_contract,
        lock_analysis: liquidityData.lock_analysis,
        largest_lp_holder: liquidityData.largest_holder,
        pair_address: liquidityData.pair_address,
        token_price: tokenPrice,
        volume_24h: volume24h,
        market_cap: marketCap,
        pool_count: liquidityData.pool_count,
        data_source: liquidityData.data_source,
        market_cap_source: liquidityData.market_cap_source,
        pair_selected_by: liquidityData.pair_selected_by,
        txns_24h: liquidityData.txns_24h,
        data_confidence: liquidityData.data_confidence,
        liquidity_data_status: liquidityData.liquidity_data_status || 'unknown',
        dex_pair_url: liquidityData.dex_pair_url,
        
        // Holder data
        top_holders: holderData.top_holders || [],
        total_holders: holderData.holder_data_status === 'observed' ? holderData.total_holders : null,
        holder_count: holderData.holder_data_status === 'observed' ? holderData.total_holders : null,
        holder_data_status: holderData.holder_data_status || 'unknown',
        active_wallets: this.calculateActiveWalletsFromVolume(Number(volume24h ?? 0), Number(marketCap ?? 0)) || holderData.active_wallets || null,
        suspicious_activity: holderData.suspicious_activity || {},
        distribution_metrics: holderData.distribution_metrics || {},
        whale_analysis: holderData.whale_analysis || {},
        wallet_activity: holderData.wallet_activity || [],
        activity_summary: this.generateActivitySummaryFromVolume(Number(volume24h ?? 0), Number(marketCap ?? 0), liquidityData.txns_24h) || holderData.activity_summary || {},
        
        // Smart contract analysis (real data)
        smart_contract_risks: await this.analyzeSmartContractRisks(contractAddress, tokenInfo),
        
        // Additional fields for compatibility
        verified: tokenInfo.verified || false,
        creation_transaction: tokenInfo.creation_transaction
      };
    } catch (error) {
      console.error('Error fetching token data:', error);
      throw new Error(`Failed to fetch token data: ${error.message}`);
    }
  }

  /**
   * Fetches token metadata from both Helius RPC and Solscan APIs
   */
  private async fetchTokenInfo(contractAddress: string) {
    try {
      console.log(`Fetching token info from Helius and Solscan for: ${contractAddress}`);
      
      // Fetch from all APIs in parallel for comprehensive data
      const [heliusData, solscanData, projectAgeData] = await Promise.all([
        this.fetchHeliusTokenData(contractAddress),
        this.fetchSolscanTokenMeta(contractAddress),
        this.fetchProjectAge(contractAddress)
      ]);

      // Merge data from all sources
      return this.mergeTokenMetadata(heliusData, solscanData, projectAgeData, contractAddress);
    } catch (error) {
      console.error('Error fetching token info:', error);
      // If APIs fail, throw error
      throw new Error(`Token metadata fetch failed: ${error.message}`);
    }
  }

  /**
   * Fetches token data from Helius RPC API
   */
  private async fetchHeliusTokenData(contractAddress: string) {
    try {
      console.log('Calling Helius RPC API...');
      
      const response = await this.helius.post('', {
        jsonrpc: '2.0',
        id: 'get-token-info',
        method: 'getAccountInfo',
        params: [
          contractAddress,
          { encoding: 'jsonParsed' }
        ]
      });

      const accountInfo = response.data.result?.value;
      if (!accountInfo) {
        throw new Error('Token account not found on Helius');
      }

      const parsedData = accountInfo.data?.parsed;
      if (!parsedData) {
        throw new Error('Unable to parse token data from Helius');
      }

      // Extract mint information
      const mintInfo = parsedData.info;
      
      return {
        source: 'helius',
        mint_authority: mintInfo.mintAuthority,
        freeze_authority: mintInfo.freezeAuthority,
        supply: mintInfo.supply,
        decimals: mintInfo.decimals,
        is_initialized: mintInfo.isInitialized,
        owner: accountInfo.owner,
        executable: accountInfo.executable,
        lamports: accountInfo.lamports,
        verified: false,
        authority_data_status: 'observed',
      };

    } catch (error: any) {
      console.error('Helius API error:', error.message);
      
      // Preserve unknown security state. A provider failure must not look like
      // renounced mint/freeze authorities.
      return {
        source: 'helius_error',
        mint_authority: undefined,
        freeze_authority: undefined,
        supply: undefined,
        decimals: undefined,
        is_initialized: undefined,
        verified: false,
        authority_data_status: 'unknown',
        error: error.message
      };
    }
  }

  /**
   * Fetches token metadata from Jupiter API (more reliable than Solscan)
   */
  private async fetchSolscanTokenMeta(contractAddress: string) {
    try {
      console.log('Calling Jupiter API...');
      
      const response = await axios.get(`https://tokens.jup.ag/token/${contractAddress}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'CTO-Vetting-System/1.0'
        }
      });

      if (!response.data) {
        throw new Error('No data received from Jupiter');
      }

      const tokenMeta = response.data;
      
      // Try to get holder count from Solscan API (with SafeFetcher)
      let holderCount = null;
      try {
        const isV2 = this.configService.get('SOLSCAN_API_KEY')?.startsWith('eyJ');
        const url = isV2 
          ? `token/meta?address=${contractAddress}`
          : `token/meta?token=${contractAddress}`;
          
        const solscanResponse = await this.solscan.get(url);
        
        if (solscanResponse.data) {
          // Handle both V1 and V2 response formats
          const raw = solscanResponse.data.data?.total || solscanResponse.data.total || solscanResponse.data.holder || solscanResponse.data.holders;
          const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
          if (Number.isFinite(parsed)) holderCount = parsed;
        }
      } catch (solscanError) {
        console.log('Could not fetch holder count from Solscan:', solscanError.message);
      }
      
      return {
        source: 'jupiter',
        symbol: tokenMeta.symbol,
        name: tokenMeta.name,
        icon: tokenMeta.logoURI,
        website: null,
        twitter: null,
        tag: tokenMeta.tags?.[0] || null,
        verified: false,
        metadata_listed: true,
        holder: holderCount,
        supply: null,
        decimals: tokenMeta.decimals || 6,
        creation_date: null
      };

    } catch (error) {
      console.error('Jupiter API error:', error.message);
      
      // Try DexScreener as backup
      try {
        console.log('Trying DexScreener as backup...');
        const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, {
          timeout: 10000
        });
        
        const tokenData = dexResponse.data.pairs?.[0]?.baseToken;
        if (tokenData) {
          // Try to get holder count from Solscan API even for DexScreener fallback
          let holderCount = null;
          try {
            const isV2 = this.configService.get('SOLSCAN_API_KEY')?.startsWith('eyJ');
            const url = isV2 
              ? `token/meta?address=${contractAddress}`
              : `token/meta?token=${contractAddress}`;
              
            const solscanResponse = await this.solscan.get(url);
            
            if (solscanResponse.data) {
              const raw = solscanResponse.data.data?.total || solscanResponse.data.total || solscanResponse.data.holder || solscanResponse.data.holders;
              const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
              if (Number.isFinite(parsed)) holderCount = parsed;
            }
          } catch (solscanError) {
            console.log('Could not fetch holder count from Solscan (DexScreener fallback):', solscanError.message);
          }
          
          return {
            source: 'dexscreener',
            symbol: tokenData.symbol,
            name: tokenData.name,
            icon: null,
            website: null,
            twitter: null,
            tag: null,
            verified: false,
            metadata_listed: true,
            holder: holderCount,
            supply: null,
            decimals: 6,
            creation_date: null
          };
        }
      } catch (dexError) {
        console.error('DexScreener backup failed:', dexError.message);
      }
      
      // Never hallucinate metadata when upstreams fail.
      return {
        source: 'metadata_unavailable',
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        verified: false,
        holder: 0,
        decimals: 6,
        creation_date: null,
        error: error.message
      };
    }
  }

  /**
   * Fetches project age by getting the earliest transaction for the token
   */
  private async fetchProjectAge(contractAddress: string) {
    try {

      console.log('Fetching project age using multiple data sources...');
      
      // Method 1: Try Solana RPC with pagination to get the actual first transaction
      try {
        console.log('Trying Solana RPC with pagination for first transaction...');
        
        // Get signatures with pagination to find the oldest transaction
        let allSignatures: any[] = [];
        let before: string | null = null;
        const maxPages = 5; // Limit to avoid rate limits
        let exhaustedHistory = false;
        
        for (let page = 0; page < maxPages; page++) {
          const params = before ? 
            [contractAddress, { limit: 1000, before }] : 
            [contractAddress, { limit: 1000 }];
          
          const rpcResponse = await axios.post(this.SOLANA_SCAN_RPC_URL, {
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignaturesForAddress',
            params
          }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (rpcResponse.data.result && rpcResponse.data.result.length > 0) {
            allSignatures = allSignatures.concat(rpcResponse.data.result);
            before = rpcResponse.data.result[rpcResponse.data.result.length - 1].signature;
            
            // If we got less than 1000, we've reached the end
            if (rpcResponse.data.result.length < 1000) {
              exhaustedHistory = true;
              break;
            }
          } else {
            exhaustedHistory = true;
            break;
          }
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (allSignatures.length > 0) {
          // Find the oldest transaction (lowest blockTime = oldest)
          const oldestTx = allSignatures.reduce((oldest, current) => {
            return (current.blockTime < oldest.blockTime) ? current : oldest;
          });
          
          if (oldestTx.blockTime) {
            const creationDate = new Date(oldestTx.blockTime * 1000);
            const ageHours = (Date.now() - creationDate.getTime()) / (1000 * 60 * 60);
            const likelyTruncated = !exhaustedHistory && allSignatures.length >= maxPages * 1000;
            if (likelyTruncated && ageHours < 24 * 30) {
              throw new Error('RPC signature window truncated; refusing potentially false young token age');
            }
            
            console.log(`✅ Real age from Solana RPC: ${ageHours.toFixed(1)} hours (from ${allSignatures.length} transactions)`);
            
            return {
              source: 'solana_rpc_first_tx',
              creation_date: creationDate,
              creation_transaction: oldestTx.signature,
              block_time: oldestTx.blockTime,
              success: true
            };
          }
        }
      } catch (rpcError) {
        console.log(`Solana RPC pagination failed: ${rpcError.message}`);
      }


      // Do NOT use DexScreener pairCreatedAt for token age.
      // Pair age can be newer than mint age and causes false "just created" outputs.
      throw new Error('Unable to determine token mint age from authoritative sources');
    } catch (error) {
      console.error('Project age API error:', error.message);
      
      return {
        source: 'age_unknown',
        creation_date: null,
        creation_transaction: null,
        block_time: null,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Merges token metadata from Helius, Solscan, and project age data
   */
  private mergeTokenMetadata(heliusData: any, solscanData: any, projectAgeData: any, contractAddress: string) {
    // Use project age data if available, otherwise fallback
    const creationDate = projectAgeData.creation_date || solscanData.creation_date || null;
    
    return {
      symbol: solscanData.symbol || 'UNKNOWN',
      name: solscanData.name || 'Unknown Token',
      mint_authority: heliusData.mint_authority,
      freeze_authority: heliusData.freeze_authority,
      authority_data_status: heliusData.authority_data_status || 'unknown',
      creation_date: creationDate,
      total_supply: heliusData.supply != null || solscanData.supply != null
        ? Number(heliusData.supply ?? solscanData.supply)
        : null,
      decimals: heliusData.decimals ?? solscanData.decimals ?? null,
      verified: solscanData.verified || false,
      holder_count: solscanData.holder || 0,
      
      // Project age specific data
      creation_transaction: projectAgeData.creation_transaction,
      block_time: projectAgeData.block_time,
      
      // API source tracking for debugging
      data_sources: {
        helius: heliusData.source,
        solscan_or_jupiter: solscanData.source,
        project_age: projectAgeData.source,
        helius_error: heliusData.error,
        solscan_error: solscanData.error,
        project_age_error: projectAgeData.error,
        project_age_success: projectAgeData.success
      }
    };
  }

  /**
   * Fetches holder distribution data from Solscan API
   */
  private async fetchHolderData(contractAddress: string) {
    try {
      console.log('Fetching holder distribution from Solscan API...');
      
      const res = await this.solscan.get(`token/holders?address=${contractAddress}&page=1&page_size=20`);
      
      // Handle Solscan V2 response structure
      const payload = res.data?.data;
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(res.data?.items)
            ? res.data.items
            : [];
      const total = Number(payload?.total ?? res.data?.total ?? list.length);
      
      const topHolders = list.map((h: any) => {
        const rawShare = Number(h.percentage ?? h.share ?? 0);
        const percentage = rawShare > 0 && rawShare <= 1 ? rawShare * 100 : rawShare;
        return {
          address: h.address || h.owner,
          amount: h.amount,
          share: Math.min(100, Math.max(0, percentage)),
        };
      });

      return {
        total_holders: total,
        holder_data_status: 'observed',
        active_wallets: 0, // will be estimated elsewhere
        top_holders: topHolders,
        suspicious_activity: {},
        distribution_metrics: {
          top10_share: topHolders.slice(0, 10).reduce((s: number, x: any) => s + (x.share || 0), 0),
        },
        whale_analysis: {},
        wallet_activity: [],
        activity_summary: {},
      };
    } catch (error: any) {
      console.error('Error fetching holder data:', error.message);
      
      return {
        total_holders: 0,
        holder_data_status: 'unknown',
        active_wallets: 0,
        top_holders: [],
        suspicious_activity: {},
        distribution_metrics: {},
        whale_analysis: {},
        wallet_activity: [],
        activity_summary: {},
      };
    }
  }

  /**
   * Fetches liquidity pool data from Raydium API
   */
  private async fetchLiquidityData(contractAddress: string) {
    try {
      // Try DexScreener first for real-time market data
      try {
        console.log('Fetching real-time data from DexScreener API...');
        const dexResponse = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, {
          timeout: 10000
        });
        
        const pairs = dexResponse.data.pairs || [];
        if (pairs.length > 0) {
          // Select pair by quality score (activity + liquidity + address match), not liquidity alone.
          const bestPair = this.selectBestDexPair(pairs, contractAddress);
          
          console.log('✅ DexScreener real data found!');
          
          // DexScreener is authoritative for market liquidity, not LP lock/burn
          // evidence. Keep those fields unknown until a lock provider or on-chain
          // locker analysis resolves them.
          const lpBurned = null;
          const lpLocked = null;
          const lockContract = null;
          const lockAnalysis = 'not_verified';
          
          const tx24hBuys = Number(bestPair?.txns?.h24?.buys || 0);
          const tx24hSells = Number(bestPair?.txns?.h24?.sells || 0);
          const tx24hTotal = tx24hBuys + tx24hSells;
          const hasFreshTrading = tx24hTotal > 0 || Number(bestPair?.volume?.h24 || 0) > 0;
          const liquidityUsd = Number(bestPair?.liquidity?.usd || 0);
          const volume24h = Number(bestPair?.volume?.h24 || 0);
          const marketCap = Number(bestPair?.marketCap || 0);
          const fdv = Number(bestPair?.fdv || 0);
          const marketCapSource = marketCap > 0 ? 'dexscreener.marketCap' : (fdv > 0 ? 'dexscreener.fdv_proxy' : 'unavailable');
          const effectiveMarketCap = marketCap > 0 ? marketCap : 0;
          const dataConfidence = hasFreshTrading && liquidityUsd >= 1000 ? 'high' : (liquidityUsd > 0 ? 'medium' : 'low');

          return {
            lp_amount_usd: liquidityUsd,
            lp_lock_months: 0, // DexScreener doesn't provide lock duration
            lp_burned: lpBurned,
            lp_locked: lpLocked,
            lp_lock_data_status: 'unknown',
            lock_contract: lockContract,
            lock_analysis: lockAnalysis,
            largest_holder: null,
            pair_address: bestPair.pairAddress,
            base_mint: contractAddress,
            quote_mint: bestPair.quoteToken?.address,
            base_reserve: 0,
            quote_reserve: 0,
            price: parseFloat(bestPair.priceUsd) || 0,
            volume_24h: volume24h,
            data_source: 'dexscreener',
            lock_burn_success: lpBurned || lpLocked,
            market_cap: effectiveMarketCap,
            price_change_24h: bestPair.priceChange?.h24 || 0,
            pool_count: pairs.length,
            market_cap_source: marketCapSource,
            pair_selected_by: 'quality_score',
            txns_24h: { buys: tx24hBuys, sells: tx24hSells, total: tx24hTotal },
            data_confidence: dataConfidence,
            liquidity_data_status: liquidityUsd > 0 ? 'observed' : 'unknown',
            dex_pair_url: bestPair?.url || null,
            pair_created_at: bestPair?.pairCreatedAt ? new Date(Number(bestPair.pairCreatedAt)) : null,
          };
        }
      } catch (dexError) {
        console.error('DexScreener failed, falling back to basic data...', dexError.message);
      }
      
      // Fallback to basic data if DexScreener fails
      console.log('Using basic liquidity data due to DexScreener failure');
      return {
        lp_amount_usd: null,
        lp_lock_months: null,
        lp_burned: null,
        lp_locked: null,
        lp_lock_data_status: 'unknown',
        lock_contract: null,
        lock_analysis: 'not_verified',
        largest_holder: null,
        pair_address: null,
        price: null,
        volume_24h: null,
        market_cap: null,
        pool_count: null,
        data_source: 'fallback',
        market_cap_source: 'unavailable',
        pair_selected_by: 'none',
        txns_24h: null,
        data_confidence: 'low',
        liquidity_data_status: 'unknown',
        dex_pair_url: null,
        pair_created_at: null,
      };
      
    } catch (error) {
      console.error('Error fetching liquidity data:', error);
      return {
        lp_amount_usd: null,
        lp_lock_months: null,
        lp_burned: null,
        lp_locked: null,
        lp_lock_data_status: 'unknown',
        lock_contract: null,
        lock_analysis: 'error_fallback',
        largest_holder: null,
        pair_address: null,
        price: null,
        volume_24h: null,
        market_cap: null,
        pool_count: null,
        data_source: 'error',
        market_cap_source: 'unavailable',
        pair_selected_by: 'none',
        txns_24h: null,
        data_confidence: 'low',
        liquidity_data_status: 'unknown',
        dex_pair_url: null,
        pair_created_at: null,
      };
    }
  }

  private selectBestDexPair(pairs: any[], contractAddress: string): any {
    const normalizedAddress = String(contractAddress || '').toLowerCase();
    const scored = pairs
      .map((pair) => {
        const liquidity = Number(pair?.liquidity?.usd || 0);
        const volume24h = Number(pair?.volume?.h24 || 0);
        const buys = Number(pair?.txns?.h24?.buys || 0);
        const sells = Number(pair?.txns?.h24?.sells || 0);
        const txCount = buys + sells;
        const pairCreatedAt = Number(pair?.pairCreatedAt || 0);
        const ageMs = Date.now() - pairCreatedAt;
        const ageDays = pairCreatedAt > 0 && ageMs > 0 ? ageMs / (1000 * 60 * 60 * 24) : null;
        const baseAddr = String(pair?.baseToken?.address || '').toLowerCase();
        const quoteAddr = String(pair?.quoteToken?.address || '').toLowerCase();
        const addressMatch = baseAddr === normalizedAddress || quoteAddr === normalizedAddress ? 1 : 0;
        const score =
          addressMatch * 1000 +
          Math.min(liquidity, 1_000_000) / 100 +
          Math.min(volume24h, 1_000_000) / 100 +
          txCount * 5 +
          (ageDays !== null && ageDays > 0.01 ? 25 : 0);
        return { pair, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.pair || pairs[0];
  }

  /**
   * Analyzes smart contract risks using Helius data and RugCheck API
   */
  private async analyzeSmartContractRisks(contractAddress: string, tokenInfo: any) {
    try {
      console.log('Analyzing smart contract risks...');

      const authorityObserved = tokenInfo?.authority_data_status === 'observed';
      const hasMint = authorityObserved ? !!tokenInfo?.mint_authority : null;
      const hasFreeze = authorityObserved ? !!tokenInfo?.freeze_authority : null;
      return {
        critical_vulnerabilities: null,
        high_vulnerabilities: hasMint || hasFreeze ? 1 : 0,
        medium_vulnerabilities: null,
        mint_authority_active: hasMint,
        freeze_authority_active: hasFreeze,
        mint_authority_risk: !authorityObserved ? 'unknown' : hasMint ? 'high' : 'none',
        freeze_authority_risk: !authorityObserved ? 'unknown' : hasFreeze ? 'high' : 'none',
        overall_risk_level: !authorityObserved ? 'unknown' : (hasMint || hasFreeze) ? 'medium' : 'low',
        security_score: null,
        authority_risk_level: !authorityObserved
          ? 'unknown'
          : hasMint && hasFreeze
            ? 'critical'
            : hasMint || hasFreeze
              ? 'high'
              : 'low',
        authority_data_status: authorityObserved ? 'observed' : 'unknown',
        full_audit: false,
        bug_bounty: false,
        security_issues: [],
        security_warnings: [],
        security_info: [],
        rugcheck_available: false,
        rugcheck_score: 0,
        rugcheck_risk_level: 'unknown',
        analysis_timestamp: new Date().toISOString(),
        risk_summary: authorityObserved
          ? 'Mint and freeze authority analysis completed; no independent audit was verified.'
          : 'Mint and freeze authority data is unavailable; no independent audit was verified.'
      };
    } catch (error) {
      console.error('Error analyzing smart contract risks:', error);
      return {
        critical_vulnerabilities: 0,
        high_vulnerabilities: 0,
        medium_vulnerabilities: 0,
        mint_authority_active: !!tokenInfo.mint_authority,
        freeze_authority_active: !!tokenInfo.freeze_authority,
        mint_authority_risk: tokenInfo.mint_authority ? 'high' : 'none',
        freeze_authority_risk: tokenInfo.freeze_authority ? 'high' : 'none',
        overall_risk_level: 'unknown',
        security_score: 50, // Neutral when analysis fails
        authority_risk_level: 'unknown',
        full_audit: false,
        bug_bounty: false,
        security_issues: [],
        security_warnings: [],
        security_info: [],
        rugcheck_available: false,
        rugcheck_score: 0,
        rugcheck_risk_level: 'unknown',
        analysis_timestamp: new Date().toISOString(),
        risk_summary: 'Security analysis failed'
      };
    }
  }

  /**
   * Calculate estimated active wallets based on volume and market cap
   */
  private calculateActiveWalletsFromVolume(volume24h: number, marketCap: number) {
    if (!volume24h || !marketCap) return null;
    
    // Estimate activity based on volume/marketcap ratio
    const volumeRatio = volume24h / marketCap;
    
    // For high-liquidity tokens, use deterministic calculation based on volume
    // Higher volume = more active wallets
    if (volume24h > 1000000) { // >$1M volume = very active
      return Math.floor(volume24h / 50000) + 50; // ~100+ active wallets for $5M+ volume
    } else if (volume24h > 100000) { // >$100K volume = active
      return Math.floor(volume24h / 20000) + 30; // ~60+ active wallets for $600K volume
    } else if (volume24h > 10000) { // >$10K volume = moderate
      return Math.floor(volume24h / 5000) + 15; // ~30+ active wallets
    } else {
      return Math.floor(volume24h / 2000) + 5; // Low activity
    }
  }

  // Fetch Moralis token market metadata/price
  private async fetchMoralisMarket(contractAddress: string) {
    try {
      console.log('Fetching Moralis market data...');
      
      const [priceRes, metaRes] = await Promise.all([
        this.moralis.get(`${contractAddress}/price`).catch((e: any) => {
          console.warn(`Moralis price fetch failed: ${e.message}`);
          return { data: null };
        }),
        this.moralis.get(`${contractAddress}/metadata`).catch((e: any) => {
          console.warn(`Moralis meta fetch failed: ${e.message}`);
          return { data: null };
        })
      ]);

      const price_usd = priceRes?.data?.usdPrice ?? null;
      const meta = metaRes?.data ?? null;

      const market_cap_usd = meta?.marketCap ?? null;
      const volume_24h_usd = meta?.volume24h ?? null;

      return {
        price_usd,
        market_cap_usd,
        volume_24h_usd,
        symbol: meta?.symbol,
        name: meta?.name,
      };
    } catch (e: any) {
      console.log('Moralis market fetch failed:', e.message);
      return null;
    }
  }

  /**
   * Generate activity summary based on real volume and market data
   */
  private generateActivitySummaryFromVolume(
    volume24h: number,
    marketCap: number,
    transactions?: { buys?: number; sells?: number; total?: number },
  ) {
    if (!volume24h || !marketCap) return null;
    
    const volumeRatio = volume24h / marketCap;
    
    let activityLevel = 'inactive';
    let activityScore = 0;
    
    // Consider both volume ratio AND absolute volume
    if (volume24h > 1000000) { // >$1M volume = very active regardless of ratio
      activityLevel = 'very_active';
      activityScore = 95;
    } else if (volume24h > 100000) { // >$100K volume = active
      activityLevel = 'active';
      activityScore = 80;
    } else if (volumeRatio > 0.1) {
      activityLevel = 'very_active';
      activityScore = 90;
    } else if (volumeRatio > 0.05) {
      activityLevel = 'active';
      activityScore = 75;
    } else if (volumeRatio > 0.01) {
      activityLevel = 'moderate';
      activityScore = 55;
    } else {
      activityLevel = 'low';
      activityScore = 25;
    }
    
    return {
      total_analyzed: Number(transactions?.total || 0) || null,
      suspicious_wallets: 0,
      recent_sell_pressure: Number(transactions?.total || 0) > 0
        ? Math.round((Number(transactions?.sells || 0) / Number(transactions?.total || 1)) * 100)
        : null,
      activity_score: activityScore,
      avg_activity_level: activityLevel,
      volume_24h: volume24h,
      market_cap: marketCap,
      volume_ratio: volumeRatio,
      status: 'derived',
    };
  }
}
