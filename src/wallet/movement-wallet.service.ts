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

  // Admin wallet to receive payments (must be set in environment)
  private readonly ADMIN_WALLET = this.configService.get(
    'MOVEMENT_ADMIN_WALLET',
    '0x1745a447b0571a69c19d779db9ef05cfeffaa67ca74c8947aca81e0482e10523' // Client's funded Nightly address
  );
  
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
   * Get Movement RPC URL based on network
   */
  private getRpcUrl(isTestnet: boolean = true): string {
    return isTestnet ? this.MOVEMENT_TESTNET_RPC : this.MOVEMENT_MAINNET_RPC;
  }

  /**
   * Get wallet balance from Movement blockchain
   */
  async getWalletBalance(walletAddress: string, tokenAddress?: string, isTestnet: boolean = true): Promise<{
    balance: string;
    tokenAddress: string;
    tokenSymbol: string;
    decimals: number;
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
    const isFungibleAsset = !tokenAddr.includes('::'); // FA addresses are hex, Coins have ::
    
    let lastError: any;

    for (const rpcUrl of urls) {
      try {
        this.logger.debug(`Fetching Movement balance for ${walletAddress} (Token: ${tokenAddr}) from ${rpcUrl}`);

        if (isFungibleAsset) {
          // Use View Function for Fungible Asset (FA)
          try {
            const response = await axios.post(`${rpcUrl}/view`, {
              function: '0x1::primary_fungible_store::balance',
              type_arguments: ['0x1::fungible_asset::Metadata'],
              arguments: [walletAddress, tokenAddr]
            }, { timeout: 10000 });

            const balance = response.data[0] || '0';
            const isUSDC = tokenAddr.toLowerCase() === '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7'.toLowerCase();
            
            return {
              balance: balance.toString(),
              tokenAddress: tokenAddr,
              tokenSymbol: isUSDC ? 'USDC.e' : 'FA',
              decimals: isUSDC ? 6 : 8,
            };
          } catch (faError: any) {
            this.logger.debug(`FA View call failed, account might not have a store yet: ${faError.message}`);
            // If account has no store, balance is 0
            return {
              balance: '0',
              tokenAddress: tokenAddr,
              tokenSymbol: 'USDC.e',
              decimals: 6,
            };
          }
        }

        // Legacy Coin Standard Check
        const response = await axios.get(`${rpcUrl}/accounts/${walletAddress}/resources`, {
          timeout: 10000,
        });

        const resources = response.data || [];
        
        const coinStore = resources.find((r: any) => 
          r.type?.includes('coin::CoinStore') && 
          (tokenAddr === '0x1::aptos_coin::AptosCoin' || r.type?.includes(tokenAddr) || r.type?.includes('0x1::move_coin::MoveCoin'))
        );

        if (!coinStore) {
          return {
            balance: '0',
            tokenAddress: tokenAddr,
            tokenSymbol: tokenAddr.includes('AptosCoin') ? 'MOVE' : 'COIN',
            decimals: 8,
          };
        }

        const balance = coinStore.data?.coin?.value || '0';
        return {
          balance: balance.toString(),
          tokenAddress: tokenAddr,
          tokenSymbol: tokenAddr.includes('AptosCoin') ? 'MOVE' : 'COIN',
          decimals: 8,
        };
      } catch (error: any) {
        lastError = error;
        if (error.response?.status === 404) {
          return {
            balance: '0',
            tokenAddress: tokenAddr,
            tokenSymbol: isFungibleAsset ? 'USDC.e' : 'MOVE',
            decimals: isFungibleAsset ? 6 : 8,
          };
        }
        this.logger.warn(`Failed to reach Movement RPC ${rpcUrl}: ${error.message}`);
        continue;
      }
    }

    this.logger.error(`All Movement RPCs failed: ${lastError.message}`);
    throw new BadRequestException(`Movement Network Unreachable. Please try again. Details: ${lastError.message}`);
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
      // STRATEGIC FIX: If this is the admin's wallet ID, we can optionally 
      // check their Nightly address as well to show the total "Admin Funds"
      const balanceData = await this.getWalletBalance(wallet.address, tokenAddress, isTestnet);

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

      // 1. Fetch transactions from blockchain
      const rpcUrl = this.getRpcUrl(isTestnet);
      const response = await axios.get(`${rpcUrl}/accounts/${wallet.address}/transactions?limit=10`, {
        timeout: 10000,
      });

      const blockchainTxs = response.data || [];
      const newTransactions: any[] = [];
      const processedHashesInLoop = new Set<string>();

      for (const tx of blockchainTxs) {
        if (tx.type !== 'user_transaction' || !tx.success || processedHashesInLoop.has(tx.hash)) continue;

        // Check if we already have this transaction in DB
        const existingTx = await (this.prisma as any).walletTransaction.findUnique({
          where: { txHash: tx.hash },
        });

        if (existingTx) {
          processedHashesInLoop.add(tx.hash);
          continue;
        }

      // 2. Parse transaction for Events (Coin or Fungible Asset)
      const events = tx.events || [];
      for (const event of events) {
        let recorded = null;
        
        try {
          // Coin Standard Events (Legacy)
          if (event.type.includes('coin::DepositEvent')) {
            const amount = event.data?.amount || '0';
            // We record it even if the user isn't the signer
            recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: 'CREDIT',
              amount: amount.toString(),
              tokenAddress: this.NATIVE_TOKEN_ADDRESS,
              tokenSymbol: 'MOVE',
              toAddress: wallet.address,
              description: `MOVE deposit detected`,
              status: 'COMPLETED',
              metadata: { version: tx.version, sender: tx.sender }
            });
          } else if (event.type.includes('coin::WithdrawEvent') && tx.sender === wallet.address) {
            const amount = event.data?.amount || '0';
            recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: 'DEBIT',
              amount: amount.toString(),
              tokenAddress: this.NATIVE_TOKEN_ADDRESS,
              tokenSymbol: 'MOVE',
              fromAddress: wallet.address,
              description: `MOVE withdrawal detected`,
              status: 'COMPLETED',
              metadata: { version: tx.version }
            });
          }
          // Fungible Asset Events (Modern - Bardock)
          // Note: FA events use 'fungible_asset::Deposit' and 'fungible_asset::Withdraw'
          else if (event.type.includes('fungible_asset::Deposit')) {
            const amount = event.data?.amount || '0';
            const eventStore = event.data?.store;
            
            // Strategic Check: Is this deposit for our user?
            // We fetch the store address once per poll if needed
            const storeAddr = await this.getPrimaryStoreAddress(wallet.address, this.TEST_TOKEN_ADDRESS, isTestnet);
            
            if (eventStore && storeAddr && eventStore.toLowerCase() === storeAddr.toLowerCase()) {
              recorded = await this.recordTransaction({
                walletId,
                txHash: tx.hash,
                txType: 'CREDIT',
                amount: amount.toString(),
                tokenAddress: this.TEST_TOKEN_ADDRESS,
                tokenSymbol: 'USDC.e',
                toAddress: wallet.address,
                description: `USDC deposit detected`,
                status: 'COMPLETED',
                metadata: { version: tx.version, sender: tx.sender, store: eventStore }
              });
            }
          } else if (event.type.includes('fungible_asset::Withdraw') && tx.sender === wallet.address) {
            const amount = event.data?.amount || '0';
            recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: 'DEBIT',
              amount: amount.toString(),
              tokenAddress: this.TEST_TOKEN_ADDRESS,
              tokenSymbol: 'USDC.e',
              fromAddress: wallet.address,
              description: `USDC withdrawal detected`,
              status: 'COMPLETED',
              metadata: { version: tx.version, store: event.data?.store }
            });
          }
        } catch (recordError: any) {
          this.logger.warn(`Failed to record transaction ${tx.hash} event ${event.type}: ${recordError.message}`);
          continue;
        }

        if (recorded) {
          newTransactions.push(recorded);
          processedHashesInLoop.add(tx.hash);
          // Don't break, check other events in same TX if any
        }
      }
    }

    // 2.5 STRATEGIC FALLBACK: Scan Admin Wallet for transfers to this user
    // This catches incoming transfers that don't appear in the user's own history
    if (this.ADMIN_WALLET) {
      try {
        const adminTxsRes = await axios.get(`${rpcUrl}/accounts/${this.ADMIN_WALLET}/transactions?limit=20`, { timeout: 10000 });
        const adminTxs = adminTxsRes.data || [];
        const storeAddr = await this.getPrimaryStoreAddress(wallet.address, this.TEST_TOKEN_ADDRESS, isTestnet);

        for (const tx of adminTxs) {
          if (!tx.success || processedHashesInLoop.has(tx.hash)) continue;

          const events = tx.events || [];
          for (const event of events) {
            if (event.type.includes('fungible_asset::Deposit') && 
                event.data?.store?.toLowerCase() === storeAddr?.toLowerCase()) {
              
              // We found a payment from admin to this user!
              const amount = event.data?.amount || '0';
              
              // Double check if already in DB
              const existing = await (this.prisma as any).walletTransaction.findUnique({ where: { txHash: tx.hash } });
              if (!existing) {
                const recorded = await this.recordTransaction({
                  walletId,
                  txHash: tx.hash,
                  txType: 'CREDIT',
                  amount: amount.toString(),
                  tokenAddress: this.TEST_TOKEN_ADDRESS,
                  tokenSymbol: 'USDC.e',
                  toAddress: wallet.address,
                  description: `USDC payment received`,
                  status: 'COMPLETED',
                  metadata: { version: tx.version, sender: tx.sender, isFromAdmin: true }
                });
                newTransactions.push(recorded);
                processedHashesInLoop.add(tx.hash);
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
          const balanceData = await this.getWalletBalance(wallet.address, tokenAddr, isTestnet);
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

      // Movement uses Aptos REST API for transactions
      // GET /accounts/{address}/transactions
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
          // Use the robust transaction polling logic
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








