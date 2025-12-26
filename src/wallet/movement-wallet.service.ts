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
  
  // Movement test token (default to native MOVE, can be overridden via env)
  // For Movement (L1 native), native token resource is 0x1::aptos_coin::AptosCoin
  // Note: Movement is now L1 (not Aptos-compatible), but uses similar resource structure
  private readonly TEST_TOKEN_ADDRESS = this.configService.get(
    'MOVEMENT_TEST_TOKEN_ADDRESS',
    '0x1::aptos_coin::AptosCoin' // Default to native MOVE token (Movement native resource)
  );
  
  // Admin wallet to receive payments (must be set in environment)
  private readonly ADMIN_WALLET = this.configService.get(
    'MOVEMENT_ADMIN_WALLET',
    '' // REQUIRED: Set this in .env file
  );
  
  // Payment amount in native token units (with decimals)
  // Example: 100000000 = 1 MOVE (if 8 decimals)
  private readonly LISTING_PAYMENT_AMOUNT = this.configService.get(
    'MOVEMENT_LISTING_PAYMENT_AMOUNT',
    '100000000' // 1 MOVE (8 decimals) - adjust based on your pricing
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
    
    let lastError: any;

    for (const rpcUrl of urls) {
      try {
        const tokenAddr = tokenAddress || this.TEST_TOKEN_ADDRESS;
        this.logger.debug(`Fetching Movement balance for ${walletAddress} from ${rpcUrl}`);

        const response = await axios.get(`${rpcUrl}/accounts/${walletAddress}/resources`, {
          timeout: 10000,
        });

        const resources = response.data || [];
        this.logger.debug(`Found ${resources.length} resources for ${walletAddress} on ${rpcUrl}`);
        
        // Log all resource types to help debug Bardock specifics
        if (resources.length > 0) {
          const types = resources.map((r: any) => r.type).join(', ');
          this.logger.debug(`Resource types for ${walletAddress.substring(0, 6)}: ${types}`);
        }

        const coinStore = resources.find((r: any) => 
          r.type?.includes('coin::CoinStore') && 
          (tokenAddr === '0x1::aptos_coin::AptosCoin' || r.type?.includes(tokenAddr) || r.type?.includes('0x1::move_coin::MoveCoin'))
        );

        if (!coinStore) {
          return {
            balance: '0',
            tokenAddress: tokenAddr,
            tokenSymbol: 'MOVE',
            decimals: 8,
          };
        }

        const balance = coinStore.data?.coin?.value || '0';
        return {
          balance: balance.toString(),
          tokenAddress: tokenAddr,
          tokenSymbol: 'MOVE',
          decimals: 8,
        };
      } catch (error: any) {
        lastError = error;
        if (error.response?.status === 404) {
          return {
            balance: '0',
            tokenAddress: tokenAddress || this.TEST_TOKEN_ADDRESS,
            tokenSymbol: 'MOVE',
            decimals: 8,
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
      const balanceData = await this.getWalletBalance(wallet.address, tokenAddress, isTestnet);

      // Upsert balance in database
      const balance = await this.prisma.walletBalance.upsert({
        where: {
          walletId_tokenAddress: {
            walletId: wallet.id,
            tokenAddress: balanceData.tokenAddress,
          },
        },
        create: {
          walletId: wallet.id,
          tokenAddress: balanceData.tokenAddress,
          tokenSymbol: balanceData.tokenSymbol,
          tokenName: 'Movement Network Token',
          decimals: balanceData.decimals,
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
    const balances = await this.prisma.walletBalance.findMany({
      where: { walletId },
      orderBy: { lastUpdated: 'desc' },
    });

    return balances;
  }

  /**
   * Get transaction history for a wallet
   */
  async getWalletTransactions(walletId: string, limit: number = 50): Promise<any[]> {
    const transactions = await this.prisma.walletTransaction.findMany({
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
    return this.prisma.walletTransaction.create({
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
    const balance = await this.prisma.walletBalance.findUnique({
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
      const balance = await this.prisma.walletBalance.findUnique({
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

      await this.prisma.walletBalance.update({
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

      for (const tx of blockchainTxs) {
        if (tx.type !== 'user_transaction' || !tx.success) continue;

        // Check if we already have this transaction
        const existingTx = await this.prisma.walletTransaction.findUnique({
          where: { txHash: tx.hash },
        });

        if (existingTx) continue;

        // 2. Parse transaction for Coin Events (Deposit/Withdraw)
        const events = tx.events || [];
        for (const event of events) {
          if (event.type.includes('coin::DepositEvent')) {
            // This is a CREDIT
            const amount = event.data?.amount || '0';
            const recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: 'CREDIT',
              amount: amount.toString(),
              tokenAddress: this.TEST_TOKEN_ADDRESS,
              tokenSymbol: 'MOVE',
              toAddress: wallet.address,
              description: `On-chain deposit detected: +${amount} units`,
              metadata: { version: tx.version, sender: tx.sender }
            });
            newTransactions.push(recorded);
          } else if (event.type.includes('coin::WithdrawEvent') && tx.sender === wallet.address) {
            // This is a DEBIT (only if the wallet was the sender)
            const amount = event.data?.amount || '0';
            const recorded = await this.recordTransaction({
              walletId,
              txHash: tx.hash,
              txType: 'DEBIT',
              amount: amount.toString(),
              tokenAddress: this.TEST_TOKEN_ADDRESS,
              tokenSymbol: 'MOVE',
              fromAddress: wallet.address,
              description: `On-chain withdrawal detected: -${amount} units`,
              metadata: { version: tx.version }
            });
            newTransactions.push(recorded);
          }
        }
      }

      // 3. Always sync the final balance at the end
      // STRATEGIC FIX: Use a direct DB update here to avoid circular dependency with syncWalletBalance
      const balanceData = await this.getWalletBalance(wallet.address, undefined, isTestnet);
      await this.prisma.walletBalance.upsert({
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
          tokenName: 'Movement Network Token',
          decimals: balanceData.decimals,
          balance: balanceData.balance,
          lastUpdated: new Date(),
        },
        update: {
          balance: balanceData.balance,
          lastUpdated: new Date(),
        },
      });

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








