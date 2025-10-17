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
      // Verify Privy token
      const privyUser = await this.privyAuthService.verifyToken(privyToken);
      
      this.logger.log(`Syncing user from Privy: ${privyUser.userId}`);

      // Get full user details and wallets from Privy
      const userDetails = await this.privyAuthService.getUserById(privyUser.userId);
      const userWallets = await this.privyAuthService.getUserWallets(privyUser.userId);
      
      // Extract email from Privy user
      const email = userDetails.email?.address || 
                    userDetails.google?.email ||
                    userDetails.twitter?.username ? `${userDetails.twitter.username}@twitter.privy` : 
                    `privy-${privyUser.userId}@ctomemes.xyz`;

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
      this.logger.error('Privy sync failed', error);
      throw error;
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
}


