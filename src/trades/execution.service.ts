import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { AptosWalletService } from '../auth/aptos-wallet.service';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { firstValueFrom } from 'rxjs';

export interface BuildTransactionRequest {
  chain: 'solana' | 'movement' | 'base';
  quote: any; // QuoteResponse from QuoteService
  walletAddress: string;
  slippageBps?: number;
}

export interface UnsignedTransaction {
  chain: 'solana' | 'movement' | 'base';
  transaction: any; // Chain-specific transaction format
  message?: string; // For Movement signing
  payload?: any; // For Movement
  lastValidBlockHeight?: number; // For Solana
  prioritizationFeeLamports?: number; // For Solana
}

export interface BroadcastRequest {
  chain: 'solana' | 'movement' | 'base';
  signedTransaction: any; // Chain-specific signed transaction
  userId: number;
  quote: any;
  walletId?: string;
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly aptosWalletService: AptosWalletService,
  ) {}

  /**
   * Build unsigned transaction for frontend signing
   */
  async buildUnsignedTransaction(request: BuildTransactionRequest): Promise<UnsignedTransaction> {
    const { chain, quote, walletAddress, slippageBps = 50 } = request;

    if (chain === 'solana') {
      return await this.buildSolanaTransaction(quote, walletAddress, slippageBps);
    } else if (chain === 'movement') {
      return await this.buildMovementTransaction(quote, walletAddress, slippageBps);
    } else if (chain === 'base') {
      return await this.buildBaseTransaction(quote, walletAddress, slippageBps);
    } else {
      throw new BadRequestException(`Unsupported chain: ${chain}`);
    }
  }

  /**
   * Build Solana swap transaction using Jupiter
   */
  private async buildSolanaTransaction(
    quote: any,
    walletAddress: string,
    slippageBps: number,
  ): Promise<UnsignedTransaction> {
    const apiKey = this.configService.get('JUPITER_API_KEY');
    const swapUrl = 'https://api.jup.ag/swap/v1/swap';

    try {
      const swapRequest = {
        userPublicKey: walletAddress,
        quoteResponse: quote.rawQuote,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'veryHigh' as const,
            maxLamports: 1000000,
          },
        },
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.post(swapUrl, swapRequest, { headers, timeout: 15_000 }),
      );

      const data = response.data;

      return {
        chain: 'solana',
        transaction: data.swapTransaction, // Base64-encoded VersionedTransaction
        lastValidBlockHeight: data.lastValidBlockHeight,
        prioritizationFeeLamports: data.prioritizationFeeLamports,
      };
    } catch (error: any) {
      this.logger.error(`Failed to build Solana transaction: ${error.message}`, error.stack);
      throw new BadRequestException(
        `Failed to build Solana transaction: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Build Movement swap transaction using Panora
   */
  private async buildMovementTransaction(
    quote: any,
    walletAddress: string,
    slippageBps: number,
  ): Promise<UnsignedTransaction> {
    const config = new AptosConfig({
      network: Network.CUSTOM,
      fullnode: this.configService.get('MOVEMENT_RPC_URL') || 'https://testnet.movementnetwork.xyz/v1',
    });
    const aptos = new Aptos(config);

    const PANORA_ROUTER = this.configService.get('PANORA_ROUTER_ADDRESS') ||
      '0x14068303f88046a78f2445b2075531d04130f14f9d0c2688b1470f80b2a91';

    try {
      const { inputMint, outputMint, inAmount, outAmount } = quote;

      // Calculate minimum amount out with slippage
      const minAmountOut = BigInt(outAmount) - (BigInt(outAmount) * BigInt(slippageBps)) / BigInt(10000);

      // Build transaction payload - use functionArguments instead of arguments
      const payload = {
        function: `${PANORA_ROUTER}::swap::swap` as `${string}::${string}::${string}`,
        typeArguments: [inputMint, outputMint],
        functionArguments: [inAmount, minAmountOut.toString()],
      };

      // Build unsigned transaction
      const rawTxn = await aptos.transaction.build.simple({
        sender: walletAddress,
        data: payload,
      });

      // Note: Frontend will generate the signing message using @aptos-labs/ts-sdk
      // Frontend uses: generateSigningMessageForTransaction(rawTxn)
      // We return the raw transaction for frontend to sign

      return {
        chain: 'movement',
        transaction: rawTxn,
        payload: {
          function: payload.function,
          typeArguments: payload.typeArguments,
          arguments: payload.functionArguments, // Return as 'arguments' for frontend compatibility
        },
      };
    } catch (error: any) {
      this.logger.error(`Failed to build Movement transaction: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to build Movement transaction: ${error.message}`);
    }
  }

  /**
   * Build Base swap transaction (EVM-compatible)
   */
  private async buildBaseTransaction(
    quote: any,
    walletAddress: string,
    slippageBps: number,
  ): Promise<UnsignedTransaction> {
    // For Base, we'll use Jupiter's swap API which supports Base chain
    const apiKey = this.configService.get('JUPITER_API_KEY');
    const swapUrl = 'https://api.jup.ag/swap/v1/swap';

    try {
      const swapRequest = {
        userPublicKey: walletAddress,
        quoteResponse: quote.rawQuote,
        wrapAndUnwrapSol: false, // Base uses ETH, not SOL
        dynamicComputeUnitLimit: false, // Not applicable for EVM
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-chain': 'base',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.post(swapUrl, swapRequest, { headers, timeout: 15_000 }),
      );

      const data = response.data;

      // For Base (EVM), Jupiter returns a transaction object
      return {
        chain: 'base',
        transaction: data.transaction || data.swapTransaction, // EVM transaction object
      };
    } catch (error: any) {
      this.logger.error(`Failed to build Base transaction: ${error.message}`, error.stack);
      throw new BadRequestException(
        `Failed to build Base transaction: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Broadcast signed transaction and record in UserTrade table
   */
  async broadcastTransaction(request: BroadcastRequest): Promise<{ txHash: string; status: string }> {
    const { chain, signedTransaction, userId, quote, walletId } = request;

    let txHash: string;
    let status = 'pending';

    try {
      if (chain === 'solana') {
        txHash = await this.broadcastSolanaTransaction(signedTransaction);
      } else if (chain === 'movement') {
        txHash = await this.broadcastMovementTransaction(signedTransaction);
      } else if (chain === 'base') {
        txHash = await this.broadcastBaseTransaction(signedTransaction);
      } else {
        throw new BadRequestException(`Unsupported chain: ${chain}`);
      }

      // Record in UserTrade table
      await this.recordUserTrade({
        userId,
        chain,
        quote,
        txHash,
        walletId,
        status: 'completed',
      });

      this.logger.log(`✅ Trade executed successfully: ${txHash} on ${chain}`);

      return { txHash, status: 'completed' };
    } catch (error: any) {
      this.logger.error(`Failed to broadcast transaction: ${error.message}`, error.stack);

      // Record failed trade
      if (txHash) {
        await this.recordUserTrade({
          userId,
          chain,
          quote,
          txHash,
          walletId,
          status: 'failed',
        });
      }

      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }
  }

  /**
   * Broadcast Solana transaction
   */
  private async broadcastSolanaTransaction(signedTransactionBase64: string): Promise<string> {
    const rpcUrl = this.configService.get('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    try {
      // Deserialize the signed transaction
      const transactionBuf = Buffer.from(signedTransactionBase64, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);

      // Send transaction
      const txid = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Wait for confirmation
      await connection.confirmTransaction(txid, 'confirmed');

      return txid;
    } catch (error: any) {
      this.logger.error(`Solana broadcast failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Broadcast Movement transaction
   */
  private async broadcastMovementTransaction(signedTransaction: any): Promise<string> {
    const config = new AptosConfig({
      network: Network.CUSTOM,
      fullnode: this.configService.get('MOVEMENT_RPC_URL') || 'https://testnet.movementnetwork.xyz/v1',
    });
    const aptos = new Aptos(config);

    try {
      // Submit the signed transaction
      // signedTransaction should be the result from frontend Privy signing
      const pendingTx = await aptos.transaction.submit.simple({
        transaction: signedTransaction.rawTxn,
        senderAuthenticator: signedTransaction.senderAuthenticator,
      });

      // Wait for confirmation
      const executedTx = await aptos.waitForTransaction({
        transactionHash: pendingTx.hash,
      });

      return executedTx.hash;
    } catch (error: any) {
      this.logger.error(`Movement broadcast failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Broadcast Base transaction (EVM-compatible)
   */
  private async broadcastBaseTransaction(signedTransaction: any): Promise<string> {
    const rpcUrl = this.configService.get('BASE_RPC_URL') || 'https://mainnet.base.org';

    try {
      // For Base (EVM), we need to use ethers.js or web3.js
      // This is a simplified version - you may need to adjust based on your setup
      const response = await firstValueFrom(
        this.httpService.post(
          rpcUrl,
          {
            jsonrpc: '2.0',
            method: 'eth_sendRawTransaction',
            params: [signedTransaction],
            id: 1,
          },
          { timeout: 30_000 },
        ),
      );

      const txHash = response.data.result;
      if (!txHash) {
        throw new Error('No transaction hash returned');
      }

      return txHash;
    } catch (error: any) {
      this.logger.error(`Base broadcast failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Record trade in UserTrade table
   */
  private async recordUserTrade(data: {
    userId: number;
    chain: 'solana' | 'movement' | 'base';
    quote: any;
    txHash: string;
    walletId?: string;
    status: 'pending' | 'completed' | 'failed';
  }): Promise<void> {
    const { userId, chain, quote, txHash, walletId, status } = data;

    try {
      // Determine trade type (BUY if input is native/stablecoin, SELL otherwise)
      const isBuy = this.isBuyTrade(quote.inputMint, chain);

      // Find listing if token exists
      const listing = await this.prisma.listing.findFirst({
        where: {
          contractAddress: quote.outputMint,
          chain: chain.toUpperCase() as any,
        },
        select: { id: true, symbol: true, name: true },
      });

      // Calculate price
      const price =
        parseFloat(quote.inAmount) > 0
          ? parseFloat(quote.outAmount) / parseFloat(quote.inAmount)
          : null;

      await this.prisma.userTrade.create({
        data: {
          userId,
          chain: chain.toLowerCase(), // Store as lowercase
          type: isBuy ? 'BUY' : 'SELL',
          tokenInAddress: quote.inputMint,
          tokenOutAddress: quote.outputMint,
          tokenInSymbol: this.extractSymbol(quote.inputMint, chain),
          tokenOutSymbol: listing?.symbol || this.extractSymbol(quote.outputMint, chain),
          amountIn: quote.inAmount,
          amountOut: quote.outAmount,
          price: price ? price : null,
          slippageBps: quote.slippageBps || 50,
          priceImpact: quote.priceImpactPct ? quote.priceImpactPct : null,
          txHash,
          status,
          walletId,
          listingId: listing?.id,
          completedAt: status === 'completed' ? new Date() : null,
        },
      });

      this.logger.log(`✅ UserTrade recorded: ${txHash}`);
    } catch (error: any) {
      // If duplicate (txHash already exists), log and continue
      if (error.code === 'P2002') {
        this.logger.warn(`UserTrade already exists for txHash: ${txHash}`);
        return;
      }
      this.logger.error(`Failed to record UserTrade: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Determine if trade is BUY or SELL
   */
  private isBuyTrade(inputMint: string, chain: string): boolean {
    const inputLower = inputMint.toLowerCase();

    if (chain === 'solana') {
      // SOL or USDC
      return (
        inputLower === 'so11111111111111111111111111111111111111112' ||
        inputLower.includes('usdc')
      );
    } else if (chain === 'movement') {
      // APTOS_COIN or USDC
      return inputLower.includes('aptos_coin') || inputLower.includes('usdc');
    } else if (chain === 'base') {
      // ETH or USDC
      return inputLower === '0x0000000000000000000000000000000000000000' || inputLower.includes('usdc');
    }

    return false;
  }

  /**
   * Extract token symbol from address
   */
  private extractSymbol(address: string, chain: string): string | null {
    if (!address) return null;

    if (chain === 'movement') {
      // Extract from type strings like "0x1::aptos_coin::AptosCoin"
      const parts = address.split('::');
      if (parts.length >= 3) {
        return parts[2].replace('Coin', '').toUpperCase();
      }
    }

    // For Solana and Base, we'd need to query the token metadata
    // For now, return null and let it be filled from Listing table
    return null;
  }
}
