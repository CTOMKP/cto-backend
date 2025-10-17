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

      // Get full user details from Privy
      const userDetails = await this.privyAuthService.getUserById(privyUser.userId);
      
      // Extract email and wallet from Privy user
      const email = userDetails.email?.address || `privy-${privyUser.userId}@ctomemes.xyz`;
      const walletAddress = userDetails.wallet?.address;

      // Check if user exists in our DB
      let user = await this.authService.findByEmail(email);

      if (!user) {
        // Create new user in our DB
        user = await this.authService.register({
          email,
          password: `privy-${privyUser.userId}`, // Placeholder password for Privy users
          walletAddress,
        });
        this.logger.log(`Created new user from Privy: ${email}`);
      } else {
        // Update wallet address if needed
        if (walletAddress && user.walletAddress !== walletAddress) {
          // You can add update logic here if needed
          this.logger.log(`Updated user wallet: ${email}`);
        }
      }

      // Generate our own JWT token for the user
      const jwtToken = await this.authService.login(user);

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          walletAddress: user.walletAddress,
          role: user.role,
        },
        token: jwtToken.access_token,
        privyUserId: privyUser.userId,
      };
    } catch (error) {
      this.logger.error('Privy sync failed', error);
      throw error;
    }
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

