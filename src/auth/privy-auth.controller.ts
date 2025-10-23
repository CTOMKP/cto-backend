import { Controller, Post, Body, Get, UseGuards, Request, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { PrivyAuthService } from './privy-auth.service';
import { AuthService } from './auth.service';
import { AptosWalletService } from './aptos-wallet.service';
import { PrivyAuthGuard } from './guards/privy-auth.guard';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('PrivyAuth')
@Controller('auth/privy')
export class PrivyAuthController {
  private readonly logger = new Logger(PrivyAuthController.name);
  private logToFile(message: string): void {
    const logFile = path.join(process.cwd(), 'privy-sync-logs.txt');
    const timestamp = new Date().toISOString();
    try {
      fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (error) {
      // If file write fails, just log to console
      console.log(`[${timestamp}] ${message}`);
    }
  }

  constructor(
    private privyAuthService: PrivyAuthService,
    private authService: AuthService,
    private aptosWalletService: AptosWalletService,
  ) {}

  /**
   * Sync/create user after Privy authentication
   * Frontend sends Privy token, we verify it and create/update user in our DB
   */
  @ApiOperation({ 
    summary: 'Sync user from Privy', 
    description: 'Verify Privy token, create/update user in DB, sync all wallets, and return JWT token' 
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        privyToken: {
          type: 'string',
          description: 'Privy access token from frontend authentication',
          example: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEyMzQifQ...'
        }
      },
      required: ['privyToken']
    }
  })
  @ApiResponse({ 
    status: 201, 
    description: 'User synced successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        user: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 5 },
            email: { type: 'string', example: 'user@example.com' },
            walletAddress: { type: 'string', example: '0x1234...' },
            role: { type: 'string', example: 'USER' },
            privyUserId: { type: 'string', example: 'did:privy:...' },
            walletsCount: { type: 'number', example: 3 }
          }
        },
        token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        wallets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              address: { type: 'string', example: '0x1234...' },
              chainType: { type: 'string', example: 'ethereum' },
              walletClient: { type: 'string', example: 'metamask' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 500, description: 'Privy sync failed' })
  @Post('sync')
  async syncUser(@Body('privyToken') privyToken: string) {
    try {
      this.logger.log('=== PRIVY SYNC START ===');
      this.logToFile('=== PRIVY SYNC START ===');
      this.logger.log(`Received token: ${privyToken?.substring(0, 50)}...`);
      this.logToFile(`Received token: ${privyToken?.substring(0, 50)}...`);
      
      // Verify Privy token
      this.logger.log('Step 1: Verifying token...');
      this.logToFile('Step 1: Verifying token...');
      this.logger.log(`Token length: ${privyToken?.length}, starts with: ${privyToken?.substring(0, 20)}...`);
      this.logToFile(`Token length: ${privyToken?.length}, starts with: ${privyToken?.substring(0, 20)}...`);
      
      const privyUser = await Promise.race([
        this.privyAuthService.verifyToken(privyToken),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Token verification timeout')), 30000))
      ]);
      
      this.logger.log(`✅ Token verified. User ID: ${(privyUser as any).userId}`);
      this.logToFile(`✅ Token verified. User ID: ${(privyUser as any).userId}`);

      // Get full user details and wallets from Privy
      this.logger.log('Step 2: Getting user details...');
      this.logToFile('Step 2: Getting user details...');
      const userDetails = await Promise.race([
        this.privyAuthService.getUserById((privyUser as any).userId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getUserById timeout')), 30000))
      ]);
      
      this.logger.log(`✅ User details received`);
      this.logToFile(`✅ User details received`);
      
      this.logger.log('Step 3: Getting user wallets...');
      this.logToFile('Step 3: Getting user wallets...');
      const userWallets = await this.privyAuthService.getUserWallets((privyUser as any).userId);
      this.logger.log(`✅ Wallets received: ${(userWallets as any)?.length || 0} wallets`);
      this.logToFile(`✅ Wallets received: ${(userWallets as any)?.length || 0} wallets`);
      
      // Extract email from Privy user - handle multiple auth methods
      let email: string;
      if ((userDetails as any).email?.address) {
        email = (userDetails as any).email.address;
      } else if ((userDetails as any).google?.email) {
        email = (userDetails as any).google.email;
      } else if ((userDetails as any).twitter?.username) {
        email = `${(userDetails as any).twitter.username}@twitter.privy`;
      } else if (userWallets && (userWallets as any).length > 0) {
        // User logged in with wallet only - use wallet address as email
        email = `${(userWallets as any)[0].address}@wallet.privy`;
      } else {
        // Fallback
        email = `privy-${(privyUser as any).userId}@ctomemes.xyz`;
      }
      
      this.logger.log(`Resolved email: ${email}`);
      this.logToFile(`Resolved email: ${email}`);

      // Check if user exists in our DB
      this.logger.log(`Step 4: Checking if user exists in DB: ${email}`);
      this.logToFile(`Step 4: Checking if user exists in DB: ${email}`);
      let user = await this.authService.findByEmail(email);
      this.logger.log(`User found in DB: ${!!user}`);
      this.logToFile(`User found in DB: ${!!user}`);

      if (!user) {
        this.logger.log(`Creating NEW user in database...`);
        // Create new user in our DB
        user = await this.authService.register({
          email,
          password: `privy-${(privyUser as any).userId}`, // Placeholder password for Privy users
        });
        
        this.logger.log(`✅ User created with ID: ${user.id}`);
        
        // Store Privy user ID
        this.logger.log(`Updating user with Privy fields...`);
        await this.authService.updateUser(user.id, {
          privyUserId: (privyUser as any).userId,
          privyDid: (userDetails as any).id,
          provider: 'privy',
          lastLoginAt: new Date(),
        });
        
        this.logger.log(`✅ Created new user from Privy: ${email} (ID: ${user.id})`);
        
        // Verify user was actually created
        const verifyUser = await this.authService.getUserById(user.id);
        this.logger.log(`Verification - User in DB: ${!!verifyUser}, Email: ${verifyUser?.email}`);
      } else {
        this.logger.log(`User already exists (ID: ${user.id}), updating...`);
        // Update Privy fields and last login
        await this.authService.updateUser(user.id, {
          privyUserId: (privyUser as any).userId,
          privyDid: (userDetails as any).id,
          lastLoginAt: new Date(),
        });
        this.logger.log(`✅ Updated existing user: ${email} (ID: ${user.id})`);
      }

      // Sync wallets from Privy
      this.logger.log(`Step 5: Syncing wallets...`);
      this.logToFile(`Step 5: Syncing wallets...`);
      if (userWallets && (userWallets as any).length > 0) {
        this.logToFile(`Found ${(userWallets as any).length} wallets from Privy API`);
        for (const wallet of (userWallets as any)) {
          this.logToFile(`Syncing wallet: ${(wallet as any).address} (${(wallet as any).chainType})`);
          await this.authService.syncPrivyWallet(user.id, {
            privyWalletId: (wallet as any).id,
            address: (wallet as any).address,
            blockchain: this.mapChainType((wallet as any).chainType),
            type: (wallet as any).id === 'embedded' ? 'PRIVY_EMBEDDED' : 'PRIVY_EXTERNAL',
            walletClient: (wallet as any).walletClient || 'privy',
            isPrimary: (userWallets as any)[0].id === (wallet as any).id,
          });
        }
        this.logger.log(`Synced ${(userWallets as any).length} wallets for user: ${email}`);
        this.logToFile(`✅ Synced ${(userWallets as any).length} wallets for user: ${email}`);
      } else {
        this.logToFile(`No wallets from Privy API, checking user.wallet...`);
        // Create embedded wallet from user.wallet if no wallets found
        if ((userDetails as any).wallet?.address) {
          this.logToFile(`Creating embedded wallet from user.wallet: ${(userDetails as any).wallet.address}`);
          await this.authService.syncPrivyWallet(user.id, {
            privyWalletId: 'embedded',
            address: (userDetails as any).wallet.address,
            blockchain: 'ETHEREUM',
            type: 'PRIVY_EMBEDDED',
            walletClient: 'privy',
            isPrimary: true,
          });
          this.logger.log(`Created embedded wallet from user data for: ${email}`);
          this.logToFile(`✅ Created embedded wallet from user data for: ${email}`);
        } else {
          this.logToFile(`⚠️ No embedded wallet found in user.wallet either!`);
        }
      }

      // Auto-create Aptos wallet (for payments on Aptos chain)
      this.logger.log('Step 6: Creating Aptos wallet...');
      this.logToFile('Step 6: Creating Aptos wallet...');
      try {
        const aptosWallet = await this.aptosWalletService.createAptosWallet(user.id);
        this.logger.log(`✅ Aptos wallet created/found: ${aptosWallet.address}`);
        this.logToFile(`✅ Aptos wallet created/found: ${aptosWallet.address}`);
      } catch (error) {
        this.logger.warn(`⚠️  Failed to create Aptos wallet: ${(error as any).message}`);
        this.logToFile(`⚠️  Failed to create Aptos wallet: ${(error as any).message}`);
        // Don't fail the entire sync if Aptos wallet creation fails
      }

      // Generate our own JWT token for the user
      const jwtToken = await this.authService.login(user);

      // Get primary wallet address
      const primaryWallet = (userWallets as any)?.[0];

      // Get all wallets including Aptos
      const allUserWallets = await this.aptosWalletService.getUserWallets(user.id);
      this.logToFile(`Step 7: Retrieved ${allUserWallets?.length || 0} total wallets from database`);

      const response = {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          walletAddress: primaryWallet?.address,
          role: user.role,
          privyUserId: (privyUser as any).userId,
          walletsCount: allUserWallets?.length || 0,
        },
        token: jwtToken.access_token,
        wallets: allUserWallets?.map(w => ({
          address: w.address,
          chainType: w.walletClient === 'APTOS_EMBEDDED' ? 'aptos' : (w.blockchain || 'UNKNOWN').toLowerCase(),
          walletClient: w.walletClient,
          isPrimary: w.isPrimary,
        })),
      };
      
      this.logToFile(`✅ SYNC COMPLETE - Returning ${response.wallets?.length || 0} wallets to frontend`);
      this.logToFile(`=== PRIVY SYNC END ===\n`);
      
      return response;
    } catch (error) {
      this.logger.error('=== PRIVY SYNC FAILED ===');
      this.logToFile('=== PRIVY SYNC FAILED ===');
      this.logger.error(`Error type: ${error.constructor.name}`);
      this.logToFile(`Error type: ${error.constructor.name}`);
      this.logger.error(`Error message: ${(error as any).message}`);
      this.logToFile(`Error message: ${(error as any).message}`);
      this.logger.error(`Error stack: ${(error as any).stack}`);
      this.logToFile(`Error stack: ${(error as any).stack}`);
      
      // Log additional Privy-specific error details
      if ((error as any).response) {
        this.logger.error(`Privy API Response: ${JSON.stringify((error as any).response.data)}`);
        this.logToFile(`Privy API Response: ${JSON.stringify((error as any).response.data)}`);
      }
      
      // Return a more helpful error message
      throw {
        statusCode: 500,
        message: `Privy sync failed: ${(error as any).message}`,
        error: error.constructor.name,
        details: process.env.NODE_ENV === 'development' ? (error as any).stack : undefined
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
  @ApiOperation({ 
    summary: 'Get current user info', 
    description: 'Get Privy user details and wallets (requires Privy token)' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'User info retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiOperation({ 
    summary: 'Verify Privy token', 
    description: 'Check if a Privy access token is valid' 
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Privy access token to verify',
          example: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      },
      required: ['token']
    }
  })
  @ApiResponse({ status: 200, description: 'Token verification result' })
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
        error: (error as any).message,
      };
    }
  }

  /**
   * Create Aptos wallet for user (Server-side generated)
   */
  @ApiOperation({ 
    summary: 'Create Aptos wallet', 
    description: 'Create a server-generated Aptos wallet for payments on Aptos chain' 
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'number',
          description: 'Internal user ID',
          example: 5
        }
      },
      required: ['userId']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Aptos wallet created',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        wallet: {
          type: 'object',
          properties: {
            address: { type: 'string', example: '0x1234...' },
            chainType: { type: 'string', example: 'aptos' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'User not found' })
  @Post('create-aptos-wallet')
  async createAptosWallet(@Body('userId') userId: number) {
    try {
      this.logger.log(`=== APTOS WALLET CREATION START ===`);
      this.logger.log(`Received userId: ${userId}`);
      
      // Get user from our database
      const user = await this.authService.getUserById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      this.logger.log(`Creating Aptos wallet for user: ${user.email}`);
      
      // Create Aptos wallet using our service
      const result = await this.aptosWalletService.createAptosWallet(userId);

      return {
        success: true,
        wallet: {
          address: result.address,
          chainType: 'aptos',
        },
      };
    } catch (error) {
      this.logger.error('=== APTOS WALLET CREATION FAILED ===');
      this.logger.error(`Error type: ${error.constructor.name}`);
      this.logger.error(`Error message: ${(error as any).message}`);
      throw {
        statusCode: 500,
        message: `Failed to create Aptos wallet: ${(error as any).message}`,
        error: error.constructor.name,
      };
    }
  }
}


