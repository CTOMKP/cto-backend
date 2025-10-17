import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';

@Injectable()
export class PrivyAuthService {
  private readonly logger = new Logger(PrivyAuthService.name);
  private privyClient: PrivyClient;

  constructor(private configService: ConfigService) {
    const appId = this.configService.get<string>('PRIVY_APP_ID');
    const appSecret = this.configService.get<string>('PRIVY_APP_SECRET');

    this.logger.log(`🔑 Privy App ID: ${appId}`);
    this.logger.log(`🔑 Privy App Secret: ${appSecret?.substring(0, 20)}...`);

    if (!appId || !appSecret) {
      this.logger.error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set in environment variables');
      throw new Error('Privy credentials not configured');
    }

    this.privyClient = new PrivyClient(appId, appSecret);
    this.logger.log('✅ Privy authentication service initialized');
  }

  /**
   * Verify Privy authentication token
   * @param token - Privy JWT token from frontend
   * @returns User claims from verified token
   * @throws UnauthorizedException if token is invalid
   */
  async verifyToken(token: string) {
    try {
      const claims = await this.privyClient.verifyAuthToken(token);
      this.logger.debug(`Token verified for user: ${claims.userId}`);
      return claims;
    } catch (error) {
      this.logger.error('Privy token verification failed', error);
      throw new UnauthorizedException('Invalid Privy authentication token');
    }
  }

  /**
   * Get user details from Privy by user ID
   * @param userId - Privy user ID
   * @returns User details from Privy
   */
  async getUserById(userId: string) {
    try {
      const user = await this.privyClient.getUserById(userId);
      this.logger.debug(`Retrieved user details for: ${userId}`);
      return user;
    } catch (error) {
      this.logger.error(`Failed to get user ${userId} from Privy`, error);
      throw new UnauthorizedException('User not found in Privy');
    }
  }

  /**
   * Get user's wallet addresses from Privy
   * @param userId - Privy user ID
   * @returns Array of wallet addresses
   */
  async getUserWallets(userId: string) {
    try {
      const user = await this.getUserById(userId);
      const wallets = user.linkedAccounts?.filter(
        (account) => account.type === 'wallet'
      );
      return wallets || [];
    } catch (error) {
      this.logger.error(`Failed to get wallets for user ${userId}`, error);
      return [];
    }
  }

  /**
   * Create an Aptos wallet for a user (Tier 2 chain) via Privy REST API
   * @param userId - Privy user ID (DID format)
   * @returns Created wallet details
   */
  async createAptosWallet(userId: string) {
    try {
      this.logger.log(`Creating Aptos wallet for user: ${userId}`);
      
      const appId = this.configService.get<string>('PRIVY_APP_ID');
      const appSecret = this.configService.get<string>('PRIVY_APP_SECRET');
      
      // Call Privy REST API to create wallet
      const axios = require('axios');
      const response = await axios.post(
        `https://auth.privy.io/api/v1/apps/${appId}/users/${userId}/wallets`,
        {
          chain_type: 'aptos',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
            'privy-app-id': appId,
          },
        }
      );
      
      this.logger.log(`✅ Aptos wallet created successfully!`);
      this.logger.log(`Address: ${response.data.address}`);
      this.logger.log(`Wallet ID: ${response.data.id}`);
      
      return {
        id: response.data.id,
        address: response.data.address,
        chainType: response.data.chain_type,
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to create Aptos wallet for user ${userId}`);
      this.logger.error(`Error status: ${error.response?.status}`);
      this.logger.error(`Error data: ${JSON.stringify(error.response?.data)}`);
      this.logger.error(`Error message: ${error.message}`);
      throw new Error(`Failed to create Aptos wallet: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get all wallets including Tier 2 chains (Aptos, etc.)
   * @param userId - Privy user ID
   * @returns All wallets for the user
   */
  async getAllUserWallets(userId: string) {
    try {
      const user = await this.getUserById(userId);
      // linkedAccounts includes all wallets (Tier 1 and Tier 2)
      const wallets = user.linkedAccounts?.filter(
        (account) => account.type === 'wallet'
      ) || [];
      
      this.logger.log(`Found ${wallets.length} wallets for user ${userId}`);
      return wallets;
    } catch (error) {
      this.logger.error(`Failed to get all wallets for user ${userId}`, error);
      return [];
    }
  }
}
