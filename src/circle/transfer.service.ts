import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios, { AxiosRequestHeaders } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CCTPTransferDto, WormholeAttestationDto, PanoraSwapDto, SupportedChains } from './dto/transfer.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);
  private base = process.env.CIRCLE_API_BASE || 'https://api.circle.com/v1/w3s';
  private apiKey = process.env.CIRCLE_API_KEY || '';
  private appId = process.env.CIRCLE_APP_ID || '';
  private wormholeApiKey = process.env.WORMHOLE_API_KEY || '';
  private wormholeRelayUrl = process.env.WORMHOLE_RELAY_URL || 'https://relayer.testnet.wormhole.com';
  private panoraApiKey = process.env.PANORA_API_KEY || '';
  private panoraBaseUrl = process.env.PANORA_BASE_URL || 'https://api.panora.exchange';
  private idempotencyKeyPrefix = process.env.IDEMPOTENCY_KEY_PREFIX || 'cto_transfer_';

  constructor(private prisma: PrismaService) {}

  /**
   * Map SupportedChains enum to Prisma Chain enum
   */
  private mapSupportedChainToPrismaChain(chain: SupportedChains): any {
    const chainMap: Record<SupportedChains, any> = {
      [SupportedChains.ETHEREUM]: 'ETHEREUM',
      [SupportedChains.BASE]: 'BASE',
      [SupportedChains.ARBITRUM]: 'ARBITRUM',
      [SupportedChains.OPTIMISM]: 'OPTIMISM',
      [SupportedChains.POLYGON]: 'POLYGON',
      [SupportedChains.AVALANCHE]: 'OTHER', // Map to OTHER for now
      [SupportedChains.SOLANA]: 'SOLANA',
    };
    return chainMap[chain] || 'UNKNOWN';
  }

  private headers(userToken?: string): AxiosRequestHeaders {
    const h: AxiosRequestHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    } as any;
    if (userToken) (h as any)['X-User-Token'] = userToken;
    return h;
  }

  // CCTP Cross-Chain USDC Transfer
  async initiateCCTPTransfer(dto: CCTPTransferDto) {
    try {
      // Get user token
      const tokenResp = await axios.post(
        `${this.base}/users/token`,
        { userId: dto.userId },
        { headers: this.headers() }
      );
      const userToken = tokenResp.data?.data?.userToken;
      if (!userToken) throw new BadRequestException('Failed to obtain user token');

      // Get user's wallet
      const user = await this.prisma.user.findUnique({ where: { email: dto.userId } });
      if (!user) throw new BadRequestException('User not found');

      let walletId = dto.walletId;
      if (!walletId) {
        const wallet = await this.prisma.wallet.findFirst({
          where: { userId: user.id, blockchain: this.mapSupportedChainToPrismaChain(dto.sourceChain) as any }
        });
        if (!wallet) throw new BadRequestException('No wallet found for source chain');
        walletId = wallet.circleWalletId;
      }

      // Create CCTP transfer via Circle API
      const transferData = {
        idempotencyKey: `${this.idempotencyKeyPrefix}${uuidv4()}`,
        source: {
          type: 'wallet',
          id: walletId,
        },
        destination: {
          type: 'blockchain',
          address: dto.destinationAddress || await this.getDestinationAddress(dto.userId, dto.destinationChain),
          chain: dto.destinationChain,
        },
        amount: {
          amount: dto.amount.toString(),
          currency: 'USDC',
        },
        fee: {
          type: 'blockchain',
        },
      };

      const transferResp = await axios.post(
        `${this.base}/transfers`,
        transferData,
        { headers: this.headers(userToken) }
      );

      const transfer = transferResp.data?.data;
      this.logger.log(`CCTP transfer initiated: ${transfer.id}`);

      return {
        success: true,
        transferId: transfer.id,
        status: transfer.status,
        sourceChain: dto.sourceChain,
        destinationChain: dto.destinationChain,
        amount: dto.amount,
        message: 'CCTP transfer initiated successfully',
        nextStep: 'Wait for attestation and redeem on destination chain'
      };

    } catch (error: any) {
      this.logger.error('CCTP transfer failed:', error.response?.data || error.message);
      throw new BadRequestException(`CCTP transfer failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get Wormhole attestation for cross-chain transfer
  async getWormholeAttestation(dto: WormholeAttestationDto) {
    try {
      // For now, return a mock attestation since we're using Circle CCTP
      // This will be replaced with actual Wormhole integration later
      this.logger.log(`Mock attestation for tx: ${dto.txHash}`);
      
      return {
        success: true,
        attestation: `mock_attestation_${dto.txHash}`,
        message: 'Mock attestation (Circle CCTP mode)',
        status: 'completed',
        data: {
          txHash: dto.txHash,
          sourceChain: dto.sourceChain,
          destinationChain: dto.destinationChain,
          attestation: `mock_attestation_${dto.txHash}`
        }
      };

    } catch (error: any) {
      this.logger.error('Attestation failed:', error.response?.data || error.message);
      throw new BadRequestException(`Attestation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Redeem USDC on destination chain using Wormhole
  async redeemWormholeTransfer(dto: WormholeAttestationDto, attestation: string) {
    try {
      // Get user token - userId should be passed in the DTO, but we'll use a default for now
      const userId = (dto as any).userId || 'user@example.com';
      const tokenResp = await axios.post(
        `${this.base}/users/token`,
        { userId },
        { headers: this.headers() }
      );
      const userToken = tokenResp.data?.data?.userToken;
      if (!userToken) throw new BadRequestException('Failed to obtain user token');

      // Create contract execution transaction to redeem on destination chain
      const redeemData = {
        idempotencyKey: `${this.idempotencyKeyPrefix}redeem_${uuidv4()}`,
        walletId: await this.getDestinationWalletId(dto.destinationChain),
        contractAddress: this.getWormholeContractAddress(dto.destinationChain),
        abiFunctionSignature: 'completeTransfer(bytes)',
        abiParameters: [attestation],
        fee: {
          type: 'blockchain',
        },
      };

      const redeemResp = await axios.post(
        `${this.base}/transactions/contractExecution`,
        redeemData,
        { headers: this.headers(userToken) }
      );

      const transaction = redeemResp.data?.data;
      this.logger.log(`Wormhole redemption initiated: ${transaction.id}`);

      return {
        success: true,
        transactionId: transaction.id,
        status: transaction.status,
        message: 'Wormhole redemption initiated successfully'
      };

    } catch (error: any) {
      this.logger.error('Wormhole redemption failed:', error.response?.data || error.message);
      throw new BadRequestException(`Wormhole redemption failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Panora Token Swap
  async executePanoraSwap(dto: PanoraSwapDto) {
    try {
      // Get user's wallet
      const user = await this.prisma.user.findUnique({ where: { email: dto.userId } });
      if (!user) throw new BadRequestException('User not found');

      // Check if user has Privy wallet or Circle wallet
      const isPivyUser = !!user.privyUserId;
      let userToken: string | null = null;
      
      if (!isPivyUser) {
        // Circle user - get user token
        const tokenResp = await axios.post(
          `${this.base}/users/token`,
          { userId: dto.userId },
          { headers: this.headers() }
        );
        userToken = tokenResp.data?.data?.userToken;
        if (!userToken) throw new BadRequestException('Failed to obtain user token');
      } else {
        this.logger.log('Privy user detected - skipping Circle user token');
      }

      let walletId = dto.walletId;
      let walletAddress: string;
      
      if (!walletId) {
        // First try to find wallet on the requested chain
        let wallet = await this.prisma.wallet.findFirst({
          where: { userId: user.id, blockchain: this.mapSupportedChainToPrismaChain(dto.chain) as any }
        });
        
        // If not found, try to find any wallet for the user
        if (!wallet) {
          wallet = await this.prisma.wallet.findFirst({
            where: { userId: user.id }
          });
        }
        
        if (!wallet) throw new BadRequestException(`No wallet found. Please create a wallet first.`);
        
        // Support both Circle and Privy wallets
        walletId = wallet.circleWalletId || wallet.id;
        walletAddress = wallet.address;
        
        // Log the actual blockchain being used
        this.logger.log(`Using wallet on ${wallet.blockchain} for ${dto.chain} swap`);
      }

      // Get swap quote from Panora using correct API structure
      this.logger.log(`Calling Panora API: ${this.panoraBaseUrl}/swap`);
      this.logger.log(`API Key: ${this.panoraApiKey.substring(0, 10)}...`);
      this.logger.log(`Full API Key: ${this.panoraApiKey}`);
      this.logger.log(`Base URL: ${this.panoraBaseUrl}`);
      
      // Map token symbols to Aptos token addresses (using real tokens with liquidity)
      const tokenAddresses = {
        'USDC': '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b', // USDC on Aptos
        'PEPE': '0xa', // Use APT instead of PEPE for testing (APT has liquidity)
        'APT': '0xa', // Native APT token
        'USDT': '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b' // Use USDC for USDT testing
      };
      
      const fromTokenAddress = tokenAddresses[dto.fromToken] || dto.fromToken;
      const toTokenAddress = tokenAddresses[dto.toToken] || dto.toToken;
      
      // Get user's wallet address - support both Circle and Privy wallets
      let finalWalletAddress: string;
      if (walletAddress) {
        // Privy wallet - use address directly
        finalWalletAddress = walletAddress;
        this.logger.log(`Using Privy wallet address: ${finalWalletAddress}`);
      } else {
        // Circle wallet - fetch via Circle API
        finalWalletAddress = await this.getWalletAddress(walletId, userToken);
        this.logger.log(`Using Circle wallet address: ${finalWalletAddress}`);
      }
      
      const queryParams = new URLSearchParams({
        fromTokenAddress: fromTokenAddress,
        toTokenAddress: toTokenAddress,
        fromTokenAmount: dto.amount.toString(),
        toWalletAddress: finalWalletAddress,
        slippagePercentage: (dto.slippage || 0.5).toString()
      });
      
      const quoteResp = await axios.post(
        `${this.panoraBaseUrl}/swap?${queryParams.toString()}`,
        {},
        {
          headers: {
            'x-api-key': this.panoraApiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const quote = quoteResp.data;
      this.logger.log(`Panora quote received: ${JSON.stringify(quote, null, 2)}`);

      // For now, return the quote data without executing the actual swap
      // The quote contains transaction data that can be used to execute the swap
      return {
        success: true,
        quote: quote,
        message: 'Token swap quote received successfully',
        nextStep: 'Use the transaction data from the quote to execute the swap'
      };

    } catch (error: any) {
      this.logger.error('Panora swap failed:', error.response?.data || error.message);
      throw new BadRequestException(`Token swap failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Helper methods
  private async getDestinationAddress(userId: string, chain: SupportedChains): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) throw new BadRequestException('User not found');

    const wallet = await this.prisma.wallet.findFirst({
      where: { userId: user.id, blockchain: this.mapSupportedChainToPrismaChain(chain) as any }
    });

    if (!wallet) throw new BadRequestException(`No wallet found for ${chain}`);
    return wallet.address;
  }

  private async getDestinationWalletId(chain: SupportedChains): Promise<string> {
    // This should be implemented based on your wallet management
    // For now, returning a placeholder
    return 'destination-wallet-id';
  }

  private getWormholeContractAddress(chain: SupportedChains): string {
    const contracts = {
      [SupportedChains.ETHEREUM]: '0x3ee18B2214AFF97000D97cf8261A6689D2C3C4C4',
      [SupportedChains.BASE]: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
      [SupportedChains.ARBITRUM]: '0x09Fb06A271faFf70A651047395AaEb6265265F13',
      [SupportedChains.OPTIMISM]: '0x2B8d80B2b4C4C4C4C4C4C4C4C4C4C4C4C4C4C4C4',
      [SupportedChains.POLYGON]: '0x5a58505a96D1dBF8dF91cB21B54419FC36e93fdE',
      [SupportedChains.AVALANCHE]: '0x09Fb06A271faFf70A651047395AaEb6265265F13',
      [SupportedChains.SOLANA]: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb',
    };
    return contracts[chain];
  }

  private async getWalletAddress(walletId: string, userToken: string): Promise<string> {
    const walletResp = await axios.get(
      `${this.base}/wallets/${walletId}`,
      { headers: this.headers(userToken) }
    );
    return walletResp.data?.data?.address;
  }
}
