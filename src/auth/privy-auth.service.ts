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
      this.logger.error('Privy error details:', {
        message: error.message,
        status: error.status,
        response: error.response?.data
      });
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
      const user = await this.privyClient.getUserById(userId);
      const wallets = [];

      // Track unique combinations of (address + blockchain) to avoid duplicates
      const addedWallets = new Set<string>();

      if (user.linkedAccounts) {
        // Log all linked accounts to see what Privy returns
        this.logger.log(`📋 RAW linkedAccounts from Privy: ${JSON.stringify(user.linkedAccounts)}`);
        
        // Filter for wallet accounts
        const linkedWallets = user.linkedAccounts.filter(
          (account: any) => {
            const hasAddress = !!account.address;
            const isWalletType = account.type === 'wallet';
            const isWalletConnector = ['injected', 'embedded', 'smart_wallet'].includes(account.connectorType);
            
            return hasAddress && (isWalletType || isWalletConnector);
          }
        );
        
        this.logger.log(`🔍 Found ${linkedWallets.length} potential wallets in linkedAccounts`);
        
        linkedWallets.forEach((w: any) => {
          const walletAddress = w.address?.toLowerCase();
          const chainType = w.chainType || 'ethereum';
          let blockchain: string;
          
          if (chainType === 'aptos' || chainType === 'movement') {
            blockchain = 'MOVEMENT';
          } else if (chainType === 'ethereum') {
            blockchain = 'ETHEREUM';
          } else if (chainType === 'solana') {
            blockchain = 'SOLANA';
          } else {
            blockchain = 'OTHER';
          }
          
          const walletKey = `${walletAddress}-${blockchain}`;
          
          if (addedWallets.has(walletKey)) {
            return;
          }
          
          let walletType = 'PRIVY_EXTERNAL';
          let walletClient = 'external';
          
          if (w.connectorType === 'embedded') {
            walletType = 'PRIVY_EMBEDDED';
            walletClient = 'privy';
          } else if (w.connectorType === 'injected') {
            walletType = 'PRIVY_EXTERNAL';
            const clientName = w.walletClientType || w.walletClient || (w as any).walletClientName || '';
            walletClient = clientName.toLowerCase() || 'metamask';
          } else if (w.connectorType === 'smart_wallet') {
            walletType = 'PRIVY_SMART_WALLET';
            walletClient = 'privy_smart_wallet';
          }

          wallets.push({
            id: w.id,
            address: w.address,
            chainType: chainType,
            blockchain: blockchain,
            walletClient: walletClient,
            type: walletType
          });
          
          addedWallets.add(walletKey);
        });
      }

      return wallets;
    } catch (error) {
      this.logger.error(`Failed to get wallets for user ${userId}`, error);
      return [];
    }
  }

      this.logger.log(`✅ Total wallets found: ${wallets.length}`);
      return wallets;
    } catch (error) {
      this.logger.error(`Failed to get wallets for user ${userId}`, error);
      return [];
    }
  }

  /**
   * Create an Aptos wallet for a user (Tier 2 chain) via Privy SDK
   * @param userId - Privy user ID (DID format)
   * @returns Created wallet details
   */
  async createAptosWallet(userId: string) {
    try {
      this.logger.log(`Creating Aptos wallet for user: ${userId}`);
      
      // First check if user already has an Aptos wallet
      const user = await this.privyClient.getUserById(userId);
      const linkedAccounts = user.linkedAccounts || [];
      const existingAptosWallet = linkedAccounts.find(
        (account: any) => account.type === 'wallet' && account.chainType === 'aptos'
      );
      
      if (existingAptosWallet) {
        this.logger.log(`User already has Aptos wallet: ${(existingAptosWallet as any).address}`);
        return {
          id: (existingAptosWallet as any).id,
          address: (existingAptosWallet as any).address,
          chainType: 'aptos',
          existed: true,
        };
      }
      
      // Temporarily disabled: Aptos wallet creation not available in current SDK version
      this.logger.warn(`No Aptos wallet found. SDK does not support Aptos creation yet.`);
      
      throw new Error(
        'Aptos wallet not found. Please contact support to enable Aptos wallets for your account.'
      );
    } catch (error: any) {
      this.logger.error(`❌ Failed to create Aptos wallet for user ${userId}`);
      this.logger.error(`Error type: ${error.constructor?.name}`);
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      throw new Error(`Failed to create Aptos wallet: ${error.message}`);
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
