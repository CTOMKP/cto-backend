import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { AptosWalletService } from '../auth/aptos-wallet.service';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { firstValueFrom } from 'rxjs';

export interface BuildTransactionRequest {
  chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';
  quote: any; // QuoteResponse from QuoteService
  walletAddress: string;
  slippageBps?: number;
}

export interface UnsignedTransaction {
  chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';
  transaction: any; // Chain-specific transaction format
  message?: string; // For Movement signing
  payload?: any; // For Movement
  isApproval?: boolean; // For Base token approvals (true if this is an approval tx, not a swap)
  tokenAddress?: string; // For Base approvals (token that needs approval)
  lastValidBlockHeight?: number; // For Solana
  prioritizationFeeLamports?: number; // For Solana
}

export interface BroadcastRequest {
  chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';
  signedTransaction: any; // Chain-specific signed transaction
  userId: number;
  quote: any;
  walletId?: string;
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private readonly NATIVE_ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

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
      // Movement signing is server-side; return a structured error to guide the frontend.
      throw new BadRequestException({
        code: 'SERVER_SIDE_SIGNING',
        message: 'Movement trades are signed server-side. Call /api/v1/trades/execute directly.',
        retryable: false,
      });
      } else if (chain === 'base' || chain === 'ethereum' || chain === 'bsc') {
        return await this.buildEvmTransaction(chain, quote, walletAddress, slippageBps);
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
      if (!data?.swapTransaction) {
        const upstreamError =
          data?.error ||
          data?.message ||
          data?.msg ||
          data?.detail ||
          'Jupiter did not return swapTransaction';
        throw new BadRequestException(
          `Failed to build Solana transaction: ${upstreamError}`,
        );
      }

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
   * Note: Jupiter's swap API only supports Solana, not Base.
   * For Base, we return the quote data and let the frontend build the transaction
   * using a Base-compatible aggregator (1inch, 0x, etc.) or direct DEX interaction.
   */
  private async buildEvmTransaction(
    chain: 'base' | 'ethereum' | 'bsc',
    quote: any,
    walletAddress: string,
    slippageBps: number,
  ): Promise<UnsignedTransaction> {
    // Jupiter's swap API doesn't support Base chain (only Solana)
    // For Base, we need to use a different approach:
    // Option 1: Use 1inch API for Base
    // Option 2: Use 0x API for Base
    // Option 3: Build transaction using Uniswap V3 router directly
    // For now, we'll return the quote data and indicate that Base swaps
    // need to be handled differently
    
    try {
      // Check if we have a 1inch API key for Base swaps
      const oneInchApiKey = this.configService.get('ONEINCH_API_KEY');
        const chainId = chain === 'ethereum' ? 1 : chain === 'bsc' ? 56 : 8453;
      
      if (!oneInchApiKey) {
        this.logger.warn('ONEINCH_API_KEY not found in environment variables');
        throw new BadRequestException({
          code: 'MISSING_API_KEY',
          message: 'EVM chain swaps require ONEINCH_API_KEY to be configured in environment variables.',
          retryable: false,
        });
      }

      // Use 1inch API for Base swaps
      // 1inch API v6.0 swap endpoint uses GET method with query parameters
        const oneInchUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/swap`;
      
      // Validate quote structure
      if (!quote || !quote.inputMint || !quote.outputMint || !quote.inAmount) {
        this.logger.error('Invalid quote structure for Base transaction', { quote });
        throw new BadRequestException({
          code: 'INVALID_QUOTE',
          message: 'Invalid quote structure. Missing required fields: inputMint, outputMint, or inAmount.',
          retryable: false,
        });
      }
      
      if (!walletAddress) {
        throw new BadRequestException({
          code: 'WALLET_NOT_FOUND',
          message: 'Wallet address is required for Base transaction',
          retryable: false,
        });
      }
      
      // Ensure token addresses are lowercase (EVM standard) - CRITICAL for 1inch API
      const srcToken = (quote.inputMint || '').toLowerCase();
      const dstToken = (quote.outputMint || '').toLowerCase();
      const fromAddress = (walletAddress || '').toLowerCase();
      
      // Native ETH sentinel address (0xeeee...)
      const NATIVE_ETH_ADDRESS = this.NATIVE_ETH_ADDRESS;
      
      // Check if this is a token → ETH sell (requires approval)
      const isTokenSell = srcToken !== NATIVE_ETH_ADDRESS;
      
      // For token sells, check allowance first (EVM requirement)
      if (isTokenSell) {
        try {
          // Step 1: Get the 1inch router/spender address for Base
            const spenderUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/approve/spender`;
          const spenderResponse = await firstValueFrom(
            this.httpService.get(spenderUrl, {
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${oneInchApiKey}`,
              },
              timeout: 10_000,
            }),
          );
          
          const spenderAddress = spenderResponse.data?.address;
          if (!spenderAddress) {
            this.logger.warn('Could not get 1inch spender address, proceeding with swap');
          } else {
            this.logger.debug(`1inch spender address for Base: ${spenderAddress}`);
          }
          
          // Step 2: Check current allowance
            const allowanceUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/approve/allowance`;
          const allowanceParams = {
            tokenAddress: srcToken,
            walletAddress: fromAddress,
          };
          
          const allowanceResponse = await firstValueFrom(
            this.httpService.get(allowanceUrl, {
              params: allowanceParams,
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${oneInchApiKey}`,
              },
              timeout: 10_000,
            }),
          );
          
          const allowance = allowanceResponse.data?.allowance || '0';
          const swapAmount = BigInt(quote.inAmount);
          const needsApproval = BigInt(allowance) < swapAmount;
          
          this.logger.debug(`Token allowance check: ${allowance} < ${quote.inAmount} = ${needsApproval}`);
          
          if (needsApproval) {
            // Step 3: Get approval transaction data
              const approveUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/approve/transaction`;
            const approveParams = {
              tokenAddress: srcToken,
              amount: quote.inAmount, // Amount to approve (can be max or specific amount)
            };
            
            const approveResponse = await firstValueFrom(
              this.httpService.get(approveUrl, {
                params: approveParams,
                headers: {
                  'Accept': 'application/json',
                  'Authorization': `Bearer ${oneInchApiKey}`,
                },
                timeout: 10_000,
              }),
            );
            
            const approveData = approveResponse.data;
            
            if (!approveData || !approveData.to || !approveData.data) {
              throw new BadRequestException({
                code: 'APPROVAL_BUILD_FAILED',
                message: 'Invalid approval transaction response from 1inch API',
                retryable: true,
              });
            }
            
            // Return approval transaction - frontend must sign and broadcast this first
              return {
                chain,
              transaction: {
                to: approveData.to,
                data: approveData.data,
                value: '0', // Approval transactions don't send ETH
                gas: approveData.gas || '0',
                gasPrice: approveData.gasPrice || '0',
              },
              isApproval: true, // Flag to indicate this is an approval, not a swap
              tokenAddress: srcToken, // Store token address for frontend
            };
          }
        } catch (allowanceError: any) {
          this.logger.warn(
            `Failed to check allowance for Base token: ${allowanceError.message}. Proceeding with swap...`
          );
          // Continue with swap - some tokens might not need approval or API might fail
        }
      }
      
      // 1inch swap endpoint uses GET with query parameters
      const swapParams = {
        src: srcToken,
        dst: dstToken,
        amount: quote.inAmount,
        from: fromAddress, // Required parameter - must be included
        slippage: slippageBps / 100, // Convert BPS to percentage (e.g., 0.5 for 0.5%)
      };

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${oneInchApiKey}`, // Can also use x-api-key header
      };

      try {
        // 1inch API v6.0 swap endpoint uses GET method with query parameters
        const response = await firstValueFrom(
          this.httpService.get(oneInchUrl, { 
            params: swapParams,
            headers,
            timeout: 15_000 
          }),
        );

        const data = response.data;

        // Validate response has tx field (critical check)
        if (!data || !data.tx) {
          this.logger.error('1inch API response missing tx field', { 
            responseData: data,
            params: swapParams 
          });
          throw new Error('Invalid response from 1inch API: missing tx field. The API likely returned an error or partial quote.');
        }

        return {
          chain,
          transaction: {
            to: data.tx.to,
            data: data.tx.data,
            value: data.tx.value || '0',
            gas: data.tx.gas || data.tx.gasLimit || '0',
            gasPrice: data.tx.gasPrice || '0',
          },
        };
      } catch (oneInchError: any) {
        // Log detailed error for debugging
        this.logger.error(
          `1inch API failed for Base: ${oneInchError.message}`,
          {
            status: oneInchError.response?.status,
            statusText: oneInchError.response?.statusText,
            data: oneInchError.response?.data,
            url: oneInchUrl,
            params: swapParams,
            hasApiKey: !!oneInchApiKey,
            apiKeyLength: oneInchApiKey?.length,
          }
        );

        const oneInchDescription = oneInchError.response?.data?.description;
        if (oneInchDescription) {
          throw new BadRequestException({
            code: 'ONEINCH_ERROR',
            message: oneInchDescription,
            retryable: false,
          });
        }
        
        // If 401, provide specific guidance
        if (oneInchError.response?.status === 401) {
          throw new BadRequestException({
            code: 'UPSTREAM_AUTH_FAILED',
            message: '1inch API authentication failed. Please verify ONEINCH_API_KEY in your 1inch dashboard.',
            retryable: false,
          });
        }
        
        // Fall through to generic error below
        throw oneInchError;
      }

      // If no 1inch API or it failed, throw informative error
      throw new BadRequestException({
        code: 'UPSTREAM_ERROR',
        message:
          'EVM chain swaps require a compatible aggregator. Please configure ONEINCH_API_KEY. Jupiter API only supports Solana swaps.',
        retryable: false,
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to build Base transaction: ${error.message}`, error.stack);
      throw new BadRequestException({
        code: 'BUILD_FAILED',
        message: `Failed to build Base transaction: ${error.response?.data?.message || error.message}`,
        retryable: true,
      });
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
        txHash = await this.broadcastMovementTransactionServerSide(userId, quote);
        } else if (chain === 'base' || chain === 'ethereum' || chain === 'bsc') {
          txHash = await this.broadcastEvmTransaction(chain, signedTransaction);
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

      throw new BadRequestException({
        code: 'EXECUTE_FAILED',
        message: `Transaction failed: ${error.message}`,
        retryable: true,
      });
    }
  }

  /**
   * Broadcast Solana transaction
   */
  private async broadcastSolanaTransaction(signedTransactionBase64: string): Promise<string> {
    if (!signedTransactionBase64 || typeof signedTransactionBase64 !== 'string') {
      throw new BadRequestException({
        code: 'SIGNED_TX_INVALID',
        message: 'signedTransaction must be a base64 string for Solana.',
        retryable: false,
      });
    }

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
   * Server-side Movement signing and broadcast (managed wallets)
   */
  private async broadcastMovementTransactionServerSide(userId: number, quote: any): Promise<string> {
    const config = new AptosConfig({
      network: Network.CUSTOM,
      fullnode: this.configService.get('MOVEMENT_RPC_URL') || 'https://testnet.movementnetwork.xyz/v1',
    });
    const aptos = new Aptos(config);

    const account = await this.aptosWalletService.getAptosAccount(userId);
    if (!account) {
      throw new BadRequestException({
        code: 'WALLET_NOT_FOUND',
        message: 'Movement wallet not found for server-side signing.',
        retryable: false,
      });
    }

    // Build unsigned Movement transaction using the server-managed account as sender
    const unsigned = await this.buildMovementTransaction(
      quote,
      account.accountAddress.toString(),
      quote?.slippageBps || 50,
    );

    try {
      const committedTxn = await aptos.signAndSubmitTransaction({
        signer: account,
        transaction: unsigned.transaction,
      });

      const executedTx = await aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      });

      return executedTx.hash;
    } catch (error: any) {
      this.logger.error(`Movement server-side broadcast failed: ${error.message}`);
      throw new BadRequestException({
        code: 'EXECUTE_FAILED',
        message: `Movement transaction failed: ${error.message}`,
        retryable: true,
      });
    }
  }

  /**
   * Broadcast Base transaction (EVM-compatible)
   */
  private async broadcastEvmTransaction(chain: 'base' | 'ethereum' | 'bsc', signedTransaction: any): Promise<string> {
    const rpcUrl =
      chain === 'ethereum'
        ? this.configService.get('ETHEREUM_RPC_URL') || 'https://rpc.ankr.com/eth'
        : chain === 'bsc'
          ? this.configService.get('BSC_RPC_URL') || 'https://bsc-dataseed.binance.org'
          : this.configService.get('BASE_RPC_URL') || 'https://mainnet.base.org';

    try {
      if (typeof signedTransaction === 'string' && /^0x[0-9a-fA-F]{64}$/.test(signedTransaction)) {
        // Already broadcasted by frontend wallet. Treat as tx hash.
        return signedTransaction;
      }

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
    chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';
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
      return inputLower === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || inputLower.includes('usdc');
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
