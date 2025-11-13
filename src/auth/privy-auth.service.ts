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

      // Debug: Log what we got
      this.logger.log(`Privy returned - Has user.wallet: ${!!user.wallet}, LinkedAccounts: ${user.linkedAccounts?.length || 0}`);
      
      // Track addresses we've already added to avoid duplicates
      const addedAddresses = new Set<string>();

      // IMPORTANT: Privy stores wallets in linkedAccounts, NOT in user.wallet
      // user.wallet is just a reference to the primary wallet, which is already in linkedAccounts
      // So we should ONLY process linkedAccounts to avoid duplicates
      
      // However, if user.wallet exists and is NOT in linkedAccounts, add it
      // (This is a fallback for edge cases)
      if (user.wallet?.address) {
        const walletInLinkedAccounts = user.linkedAccounts?.some(
          (acc: any) => acc.type === 'wallet' && 
                       acc.address?.toLowerCase() === user.wallet.address.toLowerCase()
        );
        
        if (!walletInLinkedAccounts) {
          // Only add user.wallet if it's not already in linkedAccounts
          const chainType = user.wallet.chainType || 'ethereum';
          this.logger.log(`Adding user.wallet (not in linkedAccounts): ${user.wallet.address} (${chainType})`);
          
          // Map chain types to our blockchain enum
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

          wallets.push({
            id: 'embedded',
            address: user.wallet.address,
            chainType: chainType,
            blockchain: blockchain,
            walletClient: 'privy',
            type: 'PRIVY_EMBEDDED'
          });
          
          addedAddresses.add(user.wallet.address.toLowerCase());
        } else {
          this.logger.log(`Skipping user.wallet - already in linkedAccounts: ${user.wallet.address}`);
        }
      }

      if (user.linkedAccounts) {
        // Log all linked accounts to see what Privy returns
        this.logger.log(`📋 All linkedAccounts: ${JSON.stringify(user.linkedAccounts.map((acc: any) => ({
          type: acc.type,
          address: acc.address,
          chainType: acc.chainType,
          connectorType: acc.connectorType,
          walletClientType: acc.walletClientType,
          walletClient: acc.walletClient
        })))}`);
        
        // Filter for wallet accounts (both type === 'wallet' and wallets in linkedAccounts)
        const linkedWallets = user.linkedAccounts.filter(
          (account: any) => account.type === 'wallet' && account.address
        );
        
        linkedWallets.forEach((w: any) => {
          const walletAddress = w.address?.toLowerCase();
          
          // Skip if we already added this address (avoid duplicates)
          if (walletAddress && addedAddresses.has(walletAddress)) {
            this.logger.log(`Skipping duplicate wallet: ${w.address}`);
            return;
          }
          
          // Log full wallet object to debug
          this.logger.log(`🔍 Wallet object: ${JSON.stringify({
            address: w.address,
            chainType: w.chainType,
            connectorType: w.connectorType,
            walletClientType: w.walletClientType,
            walletClient: w.walletClient,
            type: w.type
          })}`);
          
          const chainType = w.chainType || 'ethereum';
          let blockchain: string;
          
          // Movement wallets are detected as chainType === 'aptos' (Aptos-compatible)
          if (chainType === 'aptos' || chainType === 'movement') {
            blockchain = 'MOVEMENT';
          } else if (chainType === 'ethereum') {
            blockchain = 'ETHEREUM';
          } else if (chainType === 'solana') {
            blockchain = 'SOLANA';
          } else {
            blockchain = 'OTHER';
          }

          // Determine wallet type based on connectorType and walletClientType
          let walletType = 'PRIVY_EXTERNAL';
          let walletClient = 'external'; // Default
          
          // Check connectorType first
          if (w.connectorType === 'embedded') {
            // Embedded wallets are Privy's managed wallets
            walletType = 'PRIVY_EMBEDDED';
            walletClient = 'privy';
          } else if (w.connectorType === 'injected') {
            // Injected wallets are external browser extensions (MetaMask, Coinbase Wallet, etc.)
            walletType = 'PRIVY_EXTERNAL';
            // Try to get the actual wallet client name
            walletClient = w.walletClientType || w.walletClient || 'metamask';
            // Normalize common wallet names
            if (walletClient.toLowerCase().includes('metamask')) {
              walletClient = 'metamask';
            } else if (walletClient.toLowerCase().includes('coinbase')) {
              walletClient = 'coinbase_wallet';
            } else if (walletClient.toLowerCase().includes('phantom')) {
              walletClient = 'phantom';
            }
          } else {
            // For other connector types, try to detect from walletClientType
            if (w.walletClientType) {
              walletClient = w.walletClientType.toLowerCase();
            } else if (w.walletClient) {
              walletClient = w.walletClient.toLowerCase();
            }
          }

          this.logger.log(`✅ Adding linked wallet: ${w.address} (${chainType} -> ${blockchain}, connectorType: ${w.connectorType}, walletType: ${walletType}, walletClient: ${walletClient})`);
          
          if (walletAddress) {
            addedAddresses.add(walletAddress);
          }
          
          wallets.push({
            id: w.id,
            address: w.address,
            chainType: chainType,
            blockchain: blockchain,
            walletClient: walletClient,
            type: walletType
          });
        });
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
