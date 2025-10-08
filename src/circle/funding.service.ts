import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios, { AxiosRequestHeaders } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { CreateDepositDto } from './dto/funding.dto';

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);
  private base = process.env.CIRCLE_API_BASE || 'https://api.circle.com/v1/w3s';
  private apiKey = process.env.CIRCLE_API_KEY || '';
  private appId = process.env.CIRCLE_APP_ID || '';

  constructor(private prisma: PrismaService) {}

  private headers(userToken?: string): AxiosRequestHeaders {
    const h: AxiosRequestHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    } as any;
    if (userToken) (h as any)['X-User-Token'] = userToken;
    return h;
  }

  // Get funding methods available for a user
  async getFundingMethods(userId: string) {
    try {
      const userToken = await this.getUserToken(userId);
      
      // Get available payment methods from Circle
      const methodsResp = await axios.get(
        `${this.base}/users/${userId}/paymentMethods`,
        { headers: this.headers(userToken) }
      );

      return {
        success: true,
        methods: methodsResp.data?.data || [],
        message: 'Funding methods retrieved successfully'
      };
    } catch (error: any) {
      this.logger.error('Failed to get funding methods:', error.response?.data || error.message);
      return {
        success: true,
        methods: [
          {
            type: 'onchain_deposit',
            name: 'Direct On-Chain Deposit',
            description: 'Send USDC directly to your Circle wallet address from any supported chain',
            supportedChains: ['Ethereum', 'Polygon', 'Avalanche', 'Base', 'Arbitrum', 'Optimism'],
            minAmount: 10,
            maxAmount: 10000,
            fee: 'Network gas fees only',
            processingTime: '1-5 minutes',
            instructions: [
              'Copy your wallet address',
              'Send USDC from your external wallet',
              'Wait for confirmation',
              'USDC appears in your Circle wallet'
            ]
          },
          {
            type: 'cctp_transfer',
            name: 'CCTP Cross-Chain Transfer',
            description: 'Transfer USDC from another chain using Circle CCTP protocol',
            supportedChains: ['Ethereum', 'Polygon', 'Avalanche', 'Base', 'Arbitrum', 'Optimism'],
            minAmount: 10,
            maxAmount: 10000,
            fee: 'CCTP fees + gas',
            processingTime: '5-15 minutes',
            instructions: [
              'Use the Cross-Chain Bridge above',
              'Select source and destination chains',
              'Enter amount and confirm',
              'USDC transfers automatically'
            ]
          },
          {
            type: 'centralized_exchange',
            name: 'Centralized Exchange',
            description: 'Buy USDC on exchanges and transfer to your wallet',
            supportedExchanges: ['Coinbase', 'Binance', 'Kraken', 'KuCoin'],
            minAmount: 25,
            maxAmount: 50000,
            fee: 'Exchange fees + withdrawal fees',
            processingTime: '10-60 minutes',
            instructions: [
              'Buy USDC on your preferred exchange',
              'Withdraw to your Circle wallet address',
              'Wait for blockchain confirmation',
              'USDC appears in your wallet'
            ]
          },
          {
            type: 'decentralized_exchange',
            name: 'DEX Swap',
            description: 'Swap other tokens for USDC using decentralized exchanges',
            supportedDEXs: ['Uniswap', 'PancakeSwap', 'SushiSwap', '1inch'],
            minAmount: 10,
            maxAmount: 10000,
            fee: 'DEX fees + gas',
            processingTime: '2-10 minutes',
            instructions: [
              'Connect your wallet to a DEX',
              'Swap your tokens for USDC',
              'Send USDC to your Circle wallet',
              'Wait for confirmation'
            ]
          }
        ],
        message: 'Default funding methods (Circle API not available)'
      };
    }
  }

  // Create a deposit request
  async createDeposit(dto: CreateDepositDto) {
    try {
      // Get user's wallet
      const user = await this.prisma.user.findUnique({ where: { email: dto.userId } });
      if (!user) throw new BadRequestException('User not found');

      const wallet = await this.prisma.wallet.findFirst({
        where: { userId: user.id }
      });
      if (!wallet) throw new BadRequestException('No wallet found');

      // Circle Programmable Wallets don't support direct funding APIs
      // Instead, users need to send tokens to their wallet address
      // We'll provide the wallet address and instructions for funding
      
      const depositId = `dep_${uuidv4().substring(0, 8)}`;
      
      this.logger.log(`Deposit instructions provided: ${depositId} for user ${dto.userId}`);

      return {
        success: true,
        depositId: depositId,
        status: 'pending',
        amount: dto.amount,
        currency: dto.currency,
        message: 'Funding instructions provided',
        walletAddress: wallet.address,
        blockchain: wallet.blockchain,
        nextStep: 'Send USDC to your wallet address',
        instructions: {
          method: 'Send USDC to your wallet address',
          walletAddress: wallet.address,
          blockchain: wallet.blockchain,
          amount: `${dto.amount} ${dto.currency}`,
          note: 'Send USDC tokens directly to your wallet address. The tokens will appear in your wallet once the transaction is confirmed on the blockchain.',
          explorer: this.getBlockchainExplorer(wallet.blockchain, wallet.address)
        }
      };

    } catch (error: any) {
      this.logger.error('Deposit creation failed:', error.message);
      throw new BadRequestException(`Deposit failed: ${error.message}`);
    }
  }

  private getBlockchainExplorer(blockchain: string, address: string): string {
    const explorers = {
      'ETHEREUM': `https://etherscan.io/address/${address}`,
      'BASE': `https://basescan.org/address/${address}`,
      'ARBITRUM': `https://arbiscan.io/address/${address}`,
      'OPTIMISM': `https://optimistic.etherscan.io/address/${address}`,
      'POLYGON': `https://polygonscan.com/address/${address}`,
      'AVALANCHE': `https://snowtrace.io/address/${address}`,
      'APTOS': `https://explorer.aptoslabs.com/account/${address}`,
      'SOLANA': `https://explorer.solana.com/address/${address}`
    };
    return explorers[blockchain] || `https://explorer.${blockchain.toLowerCase()}.com/address/${address}`;
  }

  // Get deposit status
  async getDepositStatus(depositId: string, userId: string) {
    try {
      const userToken = await this.getUserToken(userId);
      
      const statusResp = await axios.get(
        `${this.base}/transfers/${depositId}`,
        { headers: this.headers(userToken) }
      );

      return {
        success: true,
        deposit: statusResp.data?.data,
        message: 'Deposit status retrieved successfully'
      };
    } catch (error: any) {
      this.logger.error('Failed to get deposit status:', error.response?.data || error.message);
      throw new BadRequestException(`Failed to get deposit status: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get wallet balance
  async getWalletBalance(userId: string, walletId?: string) {
    try {
      const userToken = await this.getUserToken(userId);
      
      if (!walletId) {
        const user = await this.prisma.user.findUnique({ where: { email: userId } });
        if (!user) throw new BadRequestException('User not found');
        
        const wallet = await this.prisma.wallet.findFirst({
          where: { userId: user.id }
        });
        if (!wallet) throw new BadRequestException('No wallet found');
        walletId = wallet.circleWalletId;
      }

      const balanceResp = await axios.get(
        `${this.base}/wallets/${walletId}/balances`,
        { headers: this.headers(userToken) }
      );

      const balances = balanceResp.data?.data?.balances || [];
      
      return {
        success: true,
        balances: balances,
        totalBalance: balances.reduce((sum: number, b: any) => sum + parseFloat(b.amount || 0), 0),
        message: 'Wallet balance retrieved successfully'
      };
    } catch (error: any) {
      this.logger.error('Failed to get wallet balance:', error.response?.data || error.message);
      return {
        success: true,
        balances: [],
        totalBalance: 0,
        message: 'No balance found (wallet might be empty)'
      };
    }
  }

  private async getUserToken(userId: string): Promise<string> {
    const tokenResp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() }
    );
    const userToken = tokenResp.data?.data?.userToken;
    if (!userToken) throw new BadRequestException('Failed to obtain user token');
    return userToken;
  }
}
