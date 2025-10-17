import { Controller, Post, Body, Get, UseGuards, Request, Logger } from '@nestjs/common';
import { PrivyAuthService } from './privy-auth.service';
import { AuthService } from './auth.service';
import { PrivyAuthGuard } from './guards/privy-auth.guard';

@Controller('auth/privy')
export class PrivyAuthController {
  private readonly logger = new Logger(PrivyAuthController.name);

  constructor(
    private privyAuthService: PrivyAuthService,
    private authService: AuthService,
  ) {}

  /**
   * Sync/create user after Privy authentication
   * Frontend sends Privy token, we verify it and create/update user in our DB
   */
  @Post('sync')
  async syncUser(@Body('privyToken') privyToken: string) {
    try {
      this.logger.log('=== PRIVY SYNC START ===');
      this.logger.log(`Received token: ${privyToken?.substring(0, 50)}...`);
      
      // Verify Privy token
      this.logger.log('Step 1: Verifying token...');
      const privyUser = await Promise.race([
        this.privyAuthService.verifyToken(privyToken),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Token verification timeout')), 10000))
      ]);
      
      this.logger.log(`✅ Token verified. User ID: ${privyUser.userId}`);

      // Get full user details and wallets from Privy
      this.logger.log('Step 2: Getting user details...');
      const userDetails = await Promise.race([
        this.privyAuthService.getUserById(privyUser.userId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getUserById timeout')), 10000))
      ]);
      
      this.logger.log(`✅ User details received`);
      
      this.logger.log('Step 3: Getting user wallets...');
      const userWallets = await Promise.race([
        this.privyAuthService.getUserWallets(privyUser.userId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getUserWallets timeout')), 10000))
      ]);
      
      this.logger.log(`✅ Wallets received: ${userWallets?.length || 0} wallets`);
      
      // Extract email from Privy user - handle multiple auth methods
      let email: string;
      if (userDetails.email?.address) {
        email = userDetails.email.address;
      } else if (userDetails.google?.email) {
        email = userDetails.google.email;
      } else if (userDetails.twitter?.username) {
        email = `${userDetails.twitter.username}@twitter.privy`;
      } else if (userWallets && userWallets.length > 0) {
        // User logged in with wallet only - use wallet address as email
        email = `${userWallets[0].address}@wallet.privy`;
      } else {
        // Fallback
        email = `privy-${privyUser.userId}@ctomemes.xyz`;
      }
      
      this.logger.log(`Resolved email: ${email}`);

      // Check if user exists in our DB
      let user = await this.authService.findByEmail(email);

      if (!user) {
        // Create new user in our DB
        user = await this.authService.register({
          email,
          password: `privy-${privyUser.userId}`, // Placeholder password for Privy users
        });
        
        // Store Privy user ID
        await this.authService.updateUser(user.id, {
          privyUserId: privyUser.userId,
          privyDid: userDetails.id,
          provider: 'privy',
          lastLoginAt: new Date(),
        });
        
        this.logger.log(`Created new user from Privy: ${email}`);
      } else {
        // Update Privy fields and last login
        await this.authService.updateUser(user.id, {
          privyUserId: privyUser.userId,
          privyDid: userDetails.id,
          lastLoginAt: new Date(),
        });
      }

      // Sync ALL wallets from Privy
      if (userWallets && userWallets.length > 0) {
        for (const wallet of userWallets) {
          await this.authService.syncPrivyWallet(user.id, {
            privyWalletId: wallet.id,
            address: wallet.address,
            blockchain: this.mapChainType(wallet.chainType),
            type: wallet.walletClient ? 'PRIVY_EXTERNAL' : 'PRIVY_EMBEDDED',
            walletClient: wallet.walletClient || 'privy',
            isPrimary: userWallets[0].id === wallet.id, // First wallet is primary
          });
        }
        this.logger.log(`Synced ${userWallets.length} wallets for user: ${email}`);
      }

      // Generate our own JWT token for the user
      const jwtToken = await this.authService.login(user);

      // Get primary wallet address
      const primaryWallet = userWallets?.[0];

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          walletAddress: primaryWallet?.address,
          role: user.role,
          privyUserId: privyUser.userId,
          walletsCount: userWallets?.length || 0,
        },
        token: jwtToken.access_token,
        wallets: userWallets?.map(w => ({
          address: w.address,
          chainType: w.chainType,
          walletClient: w.walletClient,
        })),
      };
    } catch (error) {
      this.logger.error('=== PRIVY SYNC FAILED ===');
      this.logger.error(`Error type: ${error.constructor.name}`);
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error(`Error stack: ${error.stack}`);
      
      // Return a more helpful error message
      throw {
        statusCode: 500,
        message: `Privy sync failed: ${error.message}`,
        error: error.constructor.name,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }

  // Helper to map Privy chain types to our Chain enum
  private mapChainType(chainType: string): string {
    const mapping = {
      'ethereum': 'ETHEREUM',
      'solana': 'SOLANA',
      'base': 'BASE',
      'polygon': 'ETHEREUM',
      'arbitrum': 'ETHEREUM',
      'optimism': 'ETHEREUM',
      'bsc': 'BSC',
      'aptos': 'APTOS',
    };
    return mapping[chainType?.toLowerCase()] || 'UNKNOWN';
  }

  /**
   * Get current Privy user info (protected route)
   */
  @Get('me')
  @UseGuards(PrivyAuthGuard)
  async getMe(@Request() req) {
    const privyUserId = req.user.userId;
    const userDetails = await this.privyAuthService.getUserById(privyUserId);
    
    return {
      privyUser: userDetails,
      wallets: await this.privyAuthService.getUserWallets(privyUserId),
    };
  }

  /**
   * Verify Privy token (utility endpoint)
   */
  @Post('verify')
  async verifyToken(@Body('token') token: string) {
    try {
      const claims = await this.privyAuthService.verifyToken(token);
      return {
        valid: true,
        userId: claims.userId,
        claims,
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  /**
   * Create Aptos wallet for user (Tier 2 chain)
   */
  @Post('create-aptos-wallet')
  async createAptosWallet(@Body('userId') userId: number) {
    try {
      // Get user from our database
      const user = await this.authService.getUserById(userId);
      if (!user || !user.privyUserId) {
        throw new Error('User not found or not linked to Privy');
      }
      
      const privyUserId = user.privyUserId;
      
      this.logger.log(`Creating Aptos wallet for Privy user: ${privyUserId}`);
      
      // Check if user already has Aptos wallet
      const allWallets = await this.privyAuthService.getAllUserWallets(privyUserId);
      const existingAptos = allWallets.find(w => w.chainType === 'aptos');
      
      if (existingAptos) {
        this.logger.log(`User already has Aptos wallet: ${existingAptos.address}`);
        return {
          success: true,
          wallet: {
            address: existingAptos.address,
            chainType: 'aptos',
            existed: true,
          },
        };
      }

      // Create new Aptos wallet
      const aptosWallet = await this.privyAuthService.createAptosWallet(privyUserId);
      
      // Sync the wallet to our DB (user already fetched above)
      if (user) {
        await this.authService.syncPrivyWallet(user.id, {
          privyWalletId: aptosWallet.id,
          address: aptosWallet.address,
          blockchain: 'APTOS',
          type: 'PRIVY_EMBEDDED',
          walletClient: 'privy',
          isPrimary: false,
        });
      }

      return {
        success: true,
        wallet: {
          address: aptosWallet.address,
          chainType: 'aptos',
          existed: false,
        },
      };
    } catch (error) {
      this.logger.error('Failed to create Aptos wallet', error);
      throw error;
    }
  }
}


