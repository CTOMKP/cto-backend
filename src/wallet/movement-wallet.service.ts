import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Movement Wallet Service
 * Handles Movement wallet balance tracking, funding detection, and payment processing
 * 
 * Movement Network:
 * - Mainnet: Chain ID 126, RPC: https://public.pimlico.io/v2/126/rpc
 * - Testnet: Chain ID 250, RPC: https://full.testnet.movementinfra.xyz/v1
 */
@Injectable()
export class MovementWalletService {
  private readonly logger = new Logger(MovementWalletService.name);
  private readonly SERVICE_VERSION = '1.0.4-BARDOCK-FINAL';
  
  // Movement RPC endpoints
  private readonly MOVEMENT_TESTNET_RPC = this.configService.get(
    'MOVEMENT_TESTNET_RPC',
    'https://testnet.movementnetwork.xyz/v1' // Movement Bardock (Latest Testnet)
  );
  private readonly MOVEMENT_INDEXER_URL = 'https://indexer.testnet.movementnetwork.xyz/v1/graphql';
  private readonly MOVEMENT_TESTNET_RPC_FALLBACK = this.configService.get(
    'MOVEMENT_TESTNET_RPC_FALLBACK',
    'https://aptos.testnet.bardock.movementnetwork.xyz/v1'
  );
  private readonly MOVEMENT_TESTNET_RPC_PIMLICO = 'https://public.pimlico.io/v2/250/rpc';
  private readonly MOVEMENT_MAINNET_RPC = this.configService.get(
    'MOVEMENT_MAINNET_RPC',
    'https://mainnet.movementlabs.xyz/v1'
  );
  
  // Movement test token (default to official USDC FA)
  private readonly TEST_TOKEN_ADDRESS = this.configService.get(
    'MOVEMENT_TEST_TOKEN_ADDRESS',
    '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7' // Official USDC.e on Bardock
  );
  
  // Native token for gas payments
  private readonly NATIVE_TOKEN_ADDRESS = '0x1::aptos_coin::AptosCoin';

  // Admin wallet to receive payments (Hardcoded to client's funded Nightly address for reliability)
  private readonly ADMIN_WALLET = '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523';
  
  // Alternative admin wallet (for backward compatibility)
  private readonly LEGACY_ADMIN_WALLET = '0x64c2df62cb5a217fb8b358fe8e5e8d183a9a592d89bfd1a2839680e9e70991a2';
  
  // Payment amount in token units
  // For USDC (6 decimals): 1,000,000 = 1.0 USDC
  private readonly LISTING_PAYMENT_AMOUNT = this.configService.get(
    'MOVEMENT_LISTING_PAYMENT_AMOUNT',
    '1000000' // 1.0 USDC
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.logger.log(`🚀 MovementWalletService initialized (Version: ${this.SERVICE_VERSION})`);
    this.logger.log(`📡 Using Movement Testnet RPC: ${this.MOVEMENT_TESTNET_RPC}`);
    if (!this.ADMIN_WALLET) {
      this.logger.warn('⚠️ MOVEMENT_ADMIN_WALLET not set - payments will fail');
    }
  }

  /**
   * Normalize a hex address to a standard 64-character format for robust comparison
   * Following Aptos/Movement standard: 0x + 64-char padded hex
   */
  private normalizeAddress(address: string): string {
    if (!address) return '';
    const pureHex = address.startsWith('0x') ? address.slice(2) : address;
    return '0x' + pureHex.padStart(64, '0').toLowerCase();
  }

  /**
   * Get Movement RPC URL based on network
   */
  private getRpcUrl(isTestnet: boolean = true): string {
    return isTestnet ? this.MOVEMENT_TESTNET_RPC : this.MOVEMENT_MAINNET_RPC;
  }

  /**
   * Get wallet balance from Movement blockchain with Stale Cache Fallback
   */
  async getWalletBalance(walletAddress: string, tokenAddress?: string, isTestnet: boolean = true, walletId?: string): Promise<{
    balance: string;
    tokenAddress: string;
    tokenSymbol: string;
    decimals: number;
    isStale?: boolean;
    lastUpdated?: Date;
  }> {
    const urls = isTestnet 
      ? [
          this.MOVEMENT_TESTNET_RPC, 
          'https://aptos.testnet.movementnetwork.xyz/v1',
          this.MOVEMENT_TESTNET_RPC_FALLBACK, 
          this.MOVEMENT_TESTNET_RPC_PIMLICO
        ]
      : [this.MOVEMENT_MAINNET_RPC];
    
    const tokenAddr = tokenAddress || this.TEST_TOKEN_ADDRESS;
    const isFungibleAsset = !tokenAddr.includes('::'); 
    
    let lastError: any;

    for (const rpcUrl of urls) {
      try {
        // ... (RPC fetch logic remains same)
        if (isFungibleAsset) {
          const response = await axios.post(`${rpcUrl}/view`, {
            function: '0x1::primary_fungible_store::balance',
            type_arguments: ['0x1::fungible_asset::Metadata'],
            arguments: [walletAddress, tokenAddr]
          }, { timeout: 10000 });

          const balance = response.data[0] || '0';
          const isUSDC = tokenAddr.toLowerCase() === this.TEST_TOKEN_ADDRESS.toLowerCase();
          
          return {
            balance: balance.toString(),
            tokenAddress: tokenAddr,
            tokenSymbol: isUSDC ? 'USDC.e' : 'FA',
            decimals: isUSDC ? 6 : 8,
            isStale: false,
            lastUpdated: new Date(),
          };
        }

        // Legacy Coin Standard
        const response = await axios.get(`${rpcUrl}/accounts/${walletAddress}/resources`, { timeout: 10000 });
        const resources = response.data || [];
        const coinStore = resources.find((r: any) => 
          r.type?.includes('coin::CoinStore') && 
          (tokenAddr === '0x1::aptos_coin::AptosCoin' || r.type?.includes(tokenAddr))
        );

        if (!coinStore) {
          return {
            balance: '0',
            tokenAddress: tokenAddr,
            tokenSymbol: tokenAddr.includes('AptosCoin') ? 'MOVE' : 'COIN',
            decimals: 8,
            isStale: false,
            lastUpdated: new Date(),
          };
        }

        const balanceValue = coinStore.data?.coin?.value || '0';
        return {
          balance: balanceValue.toString(),
          tokenAddress: tokenAddr,
          tokenSymbol: tokenAddr.includes('AptosCoin') ? 'MOVE' : 'COIN',
          decimals: 8,
          isStale: false,
          lastUpdated: new Date(),
        };
      } catch (error: any) {
        lastError = error;
        // ... (handle 404)
        if (error.response?.status === 404) {
          return {
            balance: '0',
            tokenAddress: tokenAddr,
            tokenSymbol: isFungibleAsset ? 'USDC.e' : 'MOVE',
            decimals: isFungibleAsset ? 6 : 8,
            isStale: false,
            lastUpdated: new Date(),
          };
        }
        this.logger.warn(`Failed to reach Movement RPC ${rpcUrl}: ${error.message}`);
        continue;
      }
    }

    // STRATEGIC FALLBACK: If all RPCs fail, try to fetch from Database Cache
    if (walletId) {
      try {
        const cachedBalance = await (this.prisma as any).walletBalance.findUnique({
          where: {
            walletId_tokenAddress: {
              walletId,
              tokenAddress: tokenAddr,
            },
          },
        });

        if (cachedBalance) {
          this.logger.warn(`📡 [STALE CACHE] Returning cached balance for ${walletAddress} due to RPC failure`);
          return {
            balance: cachedBalance.balance,
            tokenAddress: cachedBalance.tokenAddress,
            tokenSymbol: cachedBalance.tokenSymbol,
            decimals: cachedBalance.decimals,
            isStale: true,
            lastUpdated: cachedBalance.lastUpdated,
          };
        }
      } catch (dbError) {
        this.logger.error(`Failed to fetch cached balance: ${dbError.message}`);
      }
    }

    this.logger.error(`All Movement RPCs failed and no cache found: ${lastError.message}`);
    throw new BadRequestException(`Movement Network Unreachable. Please try again later.`);
  }

  /**
   * Sync wallet balance to database
   */
  async syncWalletBalance(walletId: string, tokenAddress?: string, isTestnet: boolean = true): Promise<any> {
    try {
      // Get wallet from database
      const wallet = await this.prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet || !wallet.address) {
        throw new NotFoundException('Wallet not found or missing address');
      }

      if (wallet.blockchain !== 'MOVEMENT') {
        throw new BadRequestException('Wallet is not a Movement wallet');
      }

      // Fetch balance from blockchain
      const balanceData = await this.getWalletBalance(wallet.address, tokenAddress, isTestnet, walletId);

      // If this is the admin wallet address, we use USDC.e defaults
      const isUSDC = balanceData.tokenAddress.toLowerCase() === this.TEST_TOKEN_ADDRESS.toLowerCase();
      
      // Upsert balance in database
      const existingBalance = await (this.prisma as any).walletBalance.findUnique({
        where: {
          walletId_tokenAddress: {
            walletId: wallet.id,
            tokenAddress: balanceData.tokenAddress,
          },
        },
      });

      const balance = await (this.prisma as any).walletBalance.upsert({
        where: {
          walletId_tokenAddress: {
            walletId: wallet.id,
            tokenAddress: balanceData.tokenAddress,
          },
        },
        create: {
          walletId: wallet.id,
          tokenAddress: balanceData.tokenAddress,
          tokenSymbol: isUSDC ? 'USDC.e' : balanceData.tokenSymbol,
          tokenName: isUSDC ? 'USDC.e (Fungible Asset)' : 'Movement Network Token',
          decimals: isUSDC ? 6 : 8,
          balance: balanceData.balance,
          lastUpdated: new Date(),
        },
        update: {
          balance: balanceData.balance,
          lastUpdated: new Date(),
        },
      });

      this.logger.log(`✅ Synced balance for wallet ${wallet.address}: ${balanceData.balance} ${balanceData.tokenSymbol}`);

      // STRATEGIC ADDITION: Also poll for transactions to ensure history (CREDITS/DEBITS) is updated
      try {
        await this.pollForTransactions(walletId, isTestnet);
      } catch (pollError) {
        this.logger.warn(`Balance synced but transaction polling failed: ${pollError.message}`);
      }

      return balance;
    } catch (error: any) {
      this.logger.error(`Failed to sync wallet balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all balances for a wallet
   */
  async getWalletBalances(walletId: string): Promise<any[]> {
    const balances = await (this.prisma as any).walletBalance.findMany({
      where: { walletId },
      orderBy: { lastUpdated: 'desc' },
    });

    return balances;
  }

  /**
   * Get transaction history for a wallet
   */
  async getWalletTransactions(walletId: string, limit: number = 50): Promise<any[]> {
    const transactions = await (this.prisma as any).walletTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return transactions;
  }

  /**
   * Record a transaction in database
   */
  async recordTransaction(data: {
    walletId: string;
    txHash: string;
    txType: 'CREDIT' | 'DEBIT' | 'TRANSFER';
    amount: string;
    tokenAddress: string;
    tokenSymbol: string;
    fromAddress?: string;
    toAddress?: string;
    paymentId?: string;
    status?: string;
    description?: string;
    metadata?: any;
  }): Promise<any> {
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
        paymentId: data.paymentId,
        status: data.status || 'COMPLETED',
        description: data.description,
        metadata: data.metadata,
      },
    });
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(walletId: string, requiredAmount: string, tokenAddress?: string): Promise<boolean> {
    const balance = await (this.prisma as any).walletBalance.findUnique({
      where: {
        walletId_tokenAddress: {
          walletId,
          tokenAddress: tokenAddress || this.TEST_TOKEN_ADDRESS,
        },
      },
    });

    if (!balance) {
      return false;
    }

    const currentBalance = BigInt(balance.balance);
    const required = BigInt(requiredAmount);

    return currentBalance >= required;
  }

  /**
   * Debit wallet balance (for payments)
   * This should be called after a successful on-chain transaction
   */
  async debitBalance(
    walletId: string,
    amount: string,
    txHash: string,
    paymentId?: string,
    tokenAddress?: string
  ): Promise<any> {
    try {
      // Get current balance
      const balance = await (this.prisma as any).walletBalance.findUnique({
        where: {
          walletId_tokenAddress: {
            walletId,
            tokenAddress: tokenAddress || this.TEST_TOKEN_ADDRESS,
          },
        },
      });

      if (!balance) {
        throw new NotFoundException('Wallet balance not found');
      }

      const currentBalance = BigInt(balance.balance);
      const debitAmount = BigInt(amount);

      if (currentBalance < debitAmount) {
        throw new BadRequestException('Insufficient balance');
      }

      // Update balance
      const newBalance = (currentBalance - debitAmount).toString();

      await (this.prisma as any).walletBalance.update({
        where: { id: balance.id },
        data: {
          balance: newBalance,
          lastUpdated: new Date(),
        },
      });

      // Record transaction
      await this.recordTransaction({
        walletId,
        txHash,
        txType: 'DEBIT',
        amount,
        tokenAddress: tokenAddress || this.TEST_TOKEN_ADDRESS,
        tokenSymbol: balance.tokenSymbol,
        toAddress: this.ADMIN_WALLET,
        paymentId,
        description: `Payment debit: ${amount} ${balance.tokenSymbol}`,
      });

      this.logger.log(`✅ Debited ${amount} ${balance.tokenSymbol} from wallet ${walletId}`);

      return {
        success: true,
        newBalance,
        transactionHash: txHash,
      };
    } catch (error: any) {
      this.logger.error(`Failed to debit balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Query Movement Indexer for USDC (Fungible Asset) activities
   */
  async queryIndexerForUSDC(walletAddress: string): Promise<any[]> {
    const usdcMetadata = this.TEST_TOKEN_ADDRESS.toLowerCase();
    const query = {
      query: `
        query GetUserUSDCHistory($owner: String!, $assetType: String!) {
          fungible_asset_activities(
            where: {
              owner_address: { _eq: $owner },
              asset_type: { _eq: $assetType }
            }
            order_by: { transaction_timestamp: desc }
            limit: 25
          ) {
            transaction_version
            amount
            type
            transaction_timestamp
          }
        }
      `,
      variables: {
        owner: walletAddress.toLowerCase(),
        assetType: usdcMetadata
      }
    };

    try {
      this.logger.debug(`📡 [INDEXER] Querying USDC History for: ${walletAddress}`);
      const response = await axios.post(this.MOVEMENT_INDEXER_URL, query, { timeout: 10000 });
      
      if (response.data?.errors) {
        this.logger.warn(`❌ [INDEXER] GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
        return [];
      }

      const activities = response.data?.data?.fungible_asset_activities || [];
      this.logger.debug(`✅ [INDEXER] Found ${activities.length} activities for USDC`);
      
      const detailedActivities: any[] = [];
      const rpcUrl = this.getRpcUrl();

      for (const activity of activities) {
        try {
          // Fetch real hash and sender from version since indexer fields vary
          const txRes = await axios.get(`${rpcUrl}/transactions/by_version/${activity.transaction_version}`);
          if (txRes.data?.hash) {
            detailedActivities.push({
              ...activity,
              transaction_hash: txRes.data.hash,
              requestor_address: txRes.data.sender || walletAddress // Fallback to walletAddress if sender unknown
            });
          }
        } catch (e) {
          this.logger.warn(`⚠️ [INDEXER] Could not fetch hash for version ${activity.transaction_version}`);
        }
      }

      return detailedActivities;
    } catch (error: any) {
      this.logger.error(`❌ [INDEXER] Failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Query Movement Indexer for MOVE (Coin Standard) activities
   */
  async queryIndexerForMOVE(walletAddress: string): Promise<any[]> {
    const coinType = this.NATIVE_TOKEN_ADDRESS; // 0x1::aptos_coin::AptosCoin
    const query = {
      query: `
        query GetUserMOVEHistory($owner: String!, $coinType: String!) {
          coin_activities(
            where: {
              owner_address: { _eq: $owner },
              coin_type: { _eq: $coinType }
            }
            order_by: { transaction_timestamp: desc }
            limit: 25
          ) {
            transaction_version
            amount
            activity_type
            transaction_timestamp
          }
        }
      `,
      variables: {
        owner: walletAddress.toLowerCase(),
        coinType: coinType
      }
    };

    try {
      this.logger.debug(`📡 [INDEXER] Querying MOVE History for: ${walletAddress}`);
      const response = await axios.post(this.MOVEMENT_INDEXER_URL, query, { timeout: 10000 });
      
      if (response.data?.errors) {
        this.logger.warn(`❌ [INDEXER-MOVE] GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
        return [];
      }

      const activities = response.data?.data?.coin_activities || [];
      this.logger.debug(`✅ [INDEXER-MOVE] Found ${activities.length} activities for MOVE`);
      
      const detailedActivities: any[] = [];
      const rpcUrl = this.getRpcUrl();

      for (const activity of activities) {
        try {
          // Fetch real hash and sender from version
          const txRes = await axios.get(`${rpcUrl}/transactions/by_version/${activity.transaction_version}`);
          if (txRes.data?.hash) {
            detailedActivities.push({
              ...activity,
              transaction_hash: txRes.data.hash,
              requestor_address: txRes.data.sender || walletAddress,
              type: activity.activity_type // Map activity_type to type
            });
          }
        } catch (e) {
          this.logger.warn(`⚠️ [INDEXER-MOVE] Could not fetch hash for version ${activity.transaction_version}`);
        }
      }

      return detailedActivities;
    } catch (error: any) {
      this.logger.error(`❌ [INDEXER-MOVE] Failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Poll for new transactions and update balances
   * Detects funding by parsing actual transaction history
   */
  async pollForTransactions(walletId: string, isTestnet: boolean = true): Promise<any[]> {
    try {
      const wallet = await this.prisma.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet || !wallet.address || wallet.blockchain !== 'MOVEMENT') {
        throw new NotFoundException('Movement wallet not found');
      }

      this.logger.debug(`Polling transactions for wallet: ${wallet.address}`);
      const newTransactions: any[] = [];

      // 1. Fetch activities from INDEXER (Modern approach for USDC)
      try {
        const usdcActivities = await this.queryIndexerForUSDC(wallet.address);
        for (const activity of usdcActivities) {
          const existingTx = await (this.prisma as any).walletTransaction.findUnique({
            where: { 
              walletId_txHash: {
                walletId: walletId,
                txHash: activity.transaction_hash
              }
            },
          });

          if (!existingTx) {
            try {
              const txType = activity.type.toUpperCase().includes('DEPOSIT') ? 'CREDIT' : 'DEBIT';
              const recorded = await this.recordTransaction({
                walletId,
                txHash: activity.transaction_hash,
                txType: txType as any,
                amount: activity.amount.toString(),
                tokenAddress: this.TEST_TOKEN_ADDRESS,
                tokenSymbol: 'USDC.e',
                fromAddress: txType === 'CREDIT' ? activity.requestor_address : wallet.address,
                toAddress: txType === 'DEBIT' ? activity.requestor_address : wallet.address,
                description: `USDC ${txType === 'CREDIT' ? 'deposit' : 'withdrawal'} detected via indexer`,
                status: 'COMPLETED',
                metadata: { version: activity.transaction_version, timestamp: activity.transaction_timestamp }
              });
              newTransactions.push(recorded);
              this.logger.log(`✅ [INDEXER] Recorded USDC ${txType} for ${wallet.address}`);
            } catch (e) {
              this.logger.warn(`Failed to record indexed USDC tx: ${e.message}`);
            }
          }
        }
      } catch (indexerErr) {
        this.logger.warn(`⚠️ [INDEXER] USDC activities fetch failed (Network Congestion): ${indexerErr.message}`);
      }

      // 1b. Fetch activities from INDEXER for MOVE (Mirroring USDC success)
      try {
        const moveActivities = await this.queryIndexerForMOVE(wallet.address);
        for (const activity of moveActivities) {
          const existingTx = await (this.prisma as any).walletTransaction.findUnique({
            where: { 
              walletId_txHash: {
                walletId: walletId,
                txHash: activity.transaction_hash
              }
            },
          });

          if (!existingTx) {
            try {
              const txType = activity.type.toUpperCase().includes('DEPOSIT') ? 'CREDIT' : 'DEBIT';
              
              // Record if it's a deposit (CREDIT) or a significant withdrawal (DEBIT)
              const amount = BigInt(activity.amount);
              if (txType === 'DEBIT' && amount < 1000n) continue; 

              const recorded = await this.recordTransaction({
                walletId,
                txHash: activity.transaction_hash,
                txType: txType as any,
                amount: activity.amount.toString(),
                tokenAddress: this.NATIVE_TOKEN_ADDRESS,
                tokenSymbol: 'MOVE',
                fromAddress: txType === 'CREDIT' ? activity.requestor_address : wallet.address,
                toAddress: txType === 'DEBIT' ? activity.requestor_address : wallet.address,
                description: `MOVE ${txType === 'CREDIT' ? 'deposit' : 'withdrawal'} detected via indexer`,
                status: 'COMPLETED',
                metadata: { version: activity.transaction_version, timestamp: activity.transaction_timestamp }
              });
              newTransactions.push(recorded);
              this.logger.log(`✅ [INDEXER] Recorded MOVE ${txType} for ${wallet.address}`);
            } catch (e) {
              this.logger.warn(`Failed to record indexed MOVE tx: ${e.message}`);
            }
          }
        }
      } catch (indexerMoveErr) {
        this.logger.warn(`⚠️ [INDEXER] MOVE activities fetch failed (Network Congestion): ${indexerMoveErr.message}`);
      }

      // 2. Fetch transactions from RPC (Master Event Scan Fallback)
      const rpcUrl = this.getRpcUrl(isTestnet);
      
      const storeAddr = await this.getPrimaryStoreAddress(wallet.address, this.TEST_TOKEN_ADDRESS, isTestnet);
      
      try {
        this.logger.debug(`📡 [MASTER-SCAN] Scanning ledger for USDC & MOVE events...`);
        const ledgerRes = await axios.get(`${rpcUrl}/transactions?limit=60`);
        const globalTxs = ledgerRes.data || [];
        
        for (const tx of globalTxs) {
          if (tx.type !== 'user_transaction' || !tx.success) continue;

          const events = tx.events || [];
          for (const event of events) {
            // 1. Handle USDC (Fungible Asset) - Requires storeAddr
            if (storeAddr) {
              const isDeposit = event.type.includes('fungible_asset::Deposit');
              const isWithdraw = event.type.includes('fungible_asset::Withdraw');
              const eventStore = event.data?.store?.toLowerCase();
              const targetStore = storeAddr.toLowerCase();
              
              if ((isDeposit || isWithdraw) && eventStore === targetStore) {
                const existingTx = await (this.prisma as any).walletTransaction.findUnique({
                  where: { walletId_txHash: { walletId: walletId, txHash: tx.hash } },
                });

                if (!existingTx) {
                  const amount = event.data?.amount || '0';
                  const txType = isDeposit ? 'CREDIT' : 'DEBIT';
                  
                  let counterparty = 'Unknown';
                  if (isWithdraw) {
                      const rec = events.find(e => e.type.includes('fungible_asset::Deposit') && e.data?.store?.toLowerCase() !== targetStore);
                      counterparty = rec ? rec.data.store : 'External';
                  } else {
                      const sen = events.find(e => e.type.includes('fungible_asset::Withdraw') && e.data?.store?.toLowerCase() !== targetStore);
                      counterparty = sen ? sen.data.store : tx.sender; 
                  }

                  const recorded = await this.recordTransaction({
                    walletId,
                    txHash: tx.hash,
                    txType: txType as any,
                    amount: amount.toString(),
                    tokenAddress: this.TEST_TOKEN_ADDRESS,
                    tokenSymbol: 'USDC.e',
                    toAddress: isDeposit ? wallet.address : counterparty,
                    fromAddress: isWithdraw ? wallet.address : counterparty,
                    description: `USDC ${isDeposit ? 'deposit' : 'payment'} detected via master scan`,
                    status: 'COMPLETED',
                    metadata: { version: tx.version, store: storeAddr, eventType: event.type }
                  });
                  newTransactions.push(recorded);
                  this.logger.log(`[MASTER-SCAN] Recorded ${txType} USDC for ${wallet.address}`);
                }
              }
            }

            // 2. Handle Native MOVE (Coin Standard) - Independent of storeAddr
            const isMoveDeposit = event.type.includes('DepositEvent') && 
                                  (event.type.includes('coin') || event.type.includes('AptosCoin'));
            
            const eventAccount = event.data?.address || 
                                 event.guid?.account_address || 
                                 event.guid?.id?.account_address ||
                                 (typeof event.guid === 'string' ? event.guid.split(':')[0] : null);
            
            if (isMoveDeposit && eventAccount) {
              const normEventAcc = this.normalizeAddress(eventAccount);
              const normWalletAcc = this.normalizeAddress(wallet.address);

              if (tx.sender !== wallet.address && normEventAcc === normWalletAcc) {
                const existingTx = await (this.prisma as any).walletTransaction.findUnique({
                  where: { walletId_txHash: { walletId: walletId, txHash: tx.hash } },
                });

                if (!existingTx) {
                  const amount = event.data?.amount || '0';
                  const recorded = await this.recordTransaction({
                    walletId,
                    txHash: tx.hash,
                    txType: 'CREDIT',
                    amount: amount.toString(),
                    tokenAddress: this.NATIVE_TOKEN_ADDRESS,
                    tokenSymbol: 'MOVE',
                    toAddress: wallet.address,
                    fromAddress: tx.sender,
                    description: `MOVE deposit detected via master scan`,
                    status: 'COMPLETED',
                    metadata: { version: tx.version, eventType: event.type }
                  });
                  newTransactions.push(recorded);
                  this.logger.log(`[MASTER-SCAN] ✅ SUCCESS: Recorded ${amount} MOVE for ${wallet.address}`);
                }
              }
            }
          }
        }
      } catch (globalErr: any) {
        this.logger.warn(`⚠️ [MASTER-SCAN] Ledger scan failed: ${globalErr.message}`);
      }

      // Legacy fallback for MOVE tokens (which DO appear in account tx list)
      const response = await axios.get(`${rpcUrl}/accounts/${wallet.address}/transactions?limit=10`, {
        timeout: 10000,
      });

      const blockchainTxs = response.data || [];

      for (const tx of blockchainTxs) {
        if (tx.type !== 'user_transaction' || !tx.success) continue;

        const existingTx = await (this.prisma as any).walletTransaction.findUnique({
          where: { 
            walletId_txHash: {
              walletId: walletId,
              txHash: tx.hash
            }
          },
        });

        if (existingTx) continue;

        const events = tx.events || [];
        let mainEventRecord = null;
        let mainType: 'CREDIT' | 'DEBIT' | 'TRANSFER' = 'TRANSFER';
        let mainToken = 'MOVE';
        let mainTokenAddr = this.NATIVE_TOKEN_ADDRESS;
        let mainAmount = '0';
        let mainDesc = '';

        const storeAddr = await this.getPrimaryStoreAddress(wallet.address, this.TEST_TOKEN_ADDRESS, isTestnet);
        const usdcDeposit = events.find(e => e.type.includes('fungible_asset::Deposit') && e.data?.store?.toLowerCase() === storeAddr?.toLowerCase());
        const usdcWithdraw = events.find(e => e.type.includes('fungible_asset::Withdraw') && e.data?.store?.toLowerCase() === storeAddr?.toLowerCase());

        if (usdcDeposit) {
          mainType = 'CREDIT';
          mainToken = 'USDC.e';
          mainTokenAddr = this.TEST_TOKEN_ADDRESS;
          mainAmount = usdcDeposit.data?.amount || '0';
          mainDesc = 'USDC deposit detected via event scan';
          mainEventRecord = usdcDeposit;
        } else if (usdcWithdraw) {
          mainType = 'DEBIT';
          mainToken = 'USDC.e';
          mainTokenAddr = this.TEST_TOKEN_ADDRESS;
          mainAmount = usdcWithdraw.data?.amount || '0';
          mainDesc = 'USDC transfer detected via event scan';
          mainEventRecord = usdcWithdraw;
        } 
        else {
          const moveWithdraw = events.find(e => e.type.includes('coin::WithdrawEvent') && tx.sender === wallet.address);
          const moveDeposit = events.find(e => e.type.includes('coin::DepositEvent'));

          if (moveWithdraw) {
            const amountValue = BigInt(moveWithdraw.data?.amount || '0');
            mainType = 'DEBIT';
            mainToken = 'MOVE';
            mainTokenAddr = this.NATIVE_TOKEN_ADDRESS;
            mainAmount = moveWithdraw.data?.amount || '0';
            mainDesc = amountValue < 500000n ? 'Gas fee' : 'MOVE withdrawal detected';
            mainEventRecord = moveWithdraw;
          } else if (moveDeposit) {
            mainType = 'CREDIT';
            mainToken = 'MOVE';
            mainTokenAddr = this.NATIVE_TOKEN_ADDRESS;
            mainAmount = moveDeposit.data?.amount || '0';
            mainDesc = 'MOVE deposit detected';
            mainEventRecord = moveDeposit;
          }
        }

        if (mainEventRecord) {
          try {
            const recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: mainType,
              amount: mainAmount.toString(),
              tokenAddress: mainTokenAddr,
              tokenSymbol: mainToken,
              fromAddress: mainType === 'CREDIT' ? tx.sender : wallet.address,
              toAddress: mainType === 'DEBIT' ? tx.sender : wallet.address,
              description: mainDesc,
              status: 'COMPLETED',
              metadata: { version: tx.version, sender: tx.sender }
            });
            newTransactions.push(recorded);
          } catch (recordError: any) {
            this.logger.warn(`Failed to record main event for ${tx.hash}: ${recordError.message}`);
          }
        }
      }

      // 2.5 SECONDARY FALLBACK: Scan Admin Wallet
      if (this.ADMIN_WALLET) {
        try {
          const adminTxsRes = await axios.get(`${rpcUrl}/accounts/${this.ADMIN_WALLET}/transactions?limit=20`, { timeout: 10000 });
          const adminTxs = adminTxsRes.data || [];
          const storeAddr = await this.getPrimaryStoreAddress(wallet.address, this.TEST_TOKEN_ADDRESS, isTestnet);

          for (const tx of adminTxs) {
            if (!tx.success) continue;

            const events = tx.events || [];
            for (const event of events) {
              if (event.type.includes('fungible_asset::Deposit') && 
                  event.data?.store?.toLowerCase() === storeAddr?.toLowerCase()) {
                
                const amount = event.data?.amount || '0';
                const existing = await (this.prisma as any).walletTransaction.findUnique({ 
                  where: { 
                    walletId_txHash: {
                      walletId: walletId,
                      txHash: tx.hash
                    }
                  } 
                });
                if (!existing) {
                  const recorded = await this.recordTransaction({
                    walletId,
                    txHash: tx.hash,
                    txType: 'CREDIT',
                    amount: amount.toString(),
                    tokenAddress: this.TEST_TOKEN_ADDRESS,
                    tokenSymbol: 'USDC.e',
                    toAddress: wallet.address,
                    description: `USDC payment received (admin scan)`,
                    status: 'COMPLETED',
                    metadata: { version: tx.version, sender: tx.sender, isFromAdmin: true }
                  });
                  newTransactions.push(recorded);
                }
              }
            }
          }
        } catch (adminErr) {
          this.logger.debug(`Admin history scan skipped: ${adminErr.message}`);
        }
      }

      // 3. Always sync BOTH MOVE and USDC balances at the end
      const tokensToSync = [this.NATIVE_TOKEN_ADDRESS, this.TEST_TOKEN_ADDRESS];
      
      for (const tokenAddr of tokensToSync) {
        try {
          const balanceData = await this.getWalletBalance(wallet.address, tokenAddr, isTestnet, walletId);
          const isUSDC = tokenAddr.toLowerCase() === this.TEST_TOKEN_ADDRESS.toLowerCase();
          
          await (this.prisma as any).walletBalance.upsert({
            where: {
              walletId_tokenAddress: {
                walletId,
                tokenAddress: balanceData.tokenAddress,
              },
            },
            create: {
              walletId,
              tokenAddress: balanceData.tokenAddress,
              tokenSymbol: balanceData.tokenSymbol,
              tokenName: isUSDC ? 'USDC.e (Fungible Asset)' : 'Movement Network Token',
              decimals: balanceData.decimals,
              balance: balanceData.balance,
              lastUpdated: new Date(),
            },
            update: {
              balance: balanceData.balance,
              lastUpdated: new Date(),
            },
          });
        } catch (err) {
          this.logger.warn(`Failed to sync balance for token ${tokenAddr}: ${err.message}`);
        }
      }

      if (newTransactions.length > 0) {
        this.logger.log(`✅ Processed ${newTransactions.length} new transactions for ${wallet.address}`);
      }

      return newTransactions;
    } catch (error: any) {
      this.logger.error(`Failed to poll for transactions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the primary store address for a fungible asset
   */
  async getPrimaryStoreAddress(walletAddress: string, tokenMetadataAddress: string, isTestnet: boolean = true): Promise<string | null> {
    try {
      const rpcUrl = this.getRpcUrl(isTestnet);
      const response = await axios.post(`${rpcUrl}/view`, {
        function: '0x1::primary_fungible_store::primary_store_address',
        type_arguments: ['0x1::fungible_asset::Metadata'],
        arguments: [walletAddress, tokenMetadataAddress]
      }, { timeout: 5000 });

      return response.data[0] || null;
    } catch (e) {
      this.logger.debug(`Could not fetch store address: ${e.message}`);
      return null;
    }
  }

  /**
   * Get latest transaction hash for a wallet address
   * Fetches from Movement REST API
   */
  private async getLatestTransactionHash(walletAddress: string, isTestnet: boolean = true): Promise<string | null> {
    try {
      const rpcUrl = this.getRpcUrl(isTestnet);

      const response = await axios.get(`${rpcUrl}/accounts/${walletAddress}/transactions?limit=1`, {
        timeout: 10000,
      });

      if (!response.data || response.data.length === 0) {
        return null;
      }

      const latestTx = response.data[0];
      return latestTx.hash || null;
    } catch (error: any) {
      this.logger.debug(`Could not fetch transaction hash: ${error.message}`);
      return null;
    }
  }

  /**
   * Sync all Movement wallets (called by cron job)
   */
  async syncAllWallets(isTestnet: boolean = true): Promise<{ synced: number; newTxs: number }> {
    try {
      const movementWallets = await this.prisma.wallet.findMany({
        where: { blockchain: 'MOVEMENT' },
      });

      let synced = 0;
      let newTxsCount = 0;

      for (const wallet of movementWallets) {
        try {
          const newTransactions = await this.pollForTransactions(wallet.id, isTestnet);
          newTxsCount += newTransactions.length;
          synced++;
        } catch (error: any) {
          this.logger.warn(`Failed to sync wallet ${wallet.id}: ${error.message}`);
        }
      }

      if (synced > 0) {
        this.logger.log(`✅ Synced ${synced} Movement wallets, processed ${newTxsCount} new transactions`);
      }
      
      return { synced, newTxs: newTxsCount };
    } catch (error: any) {
      this.logger.error(`Failed to sync all wallets: ${error.message}`);
      throw error;
    }
  }
}
