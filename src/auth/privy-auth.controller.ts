import { Controller, Post, Body, Get, UseGuards, Request, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { PrivyAuthService } from './privy-auth.service';
import { AuthService } from './auth.service';
import { AptosWalletService } from './aptos-wallet.service';
import { PrivyAuthGuard } from './guards/privy-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
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

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    initialDelay: number,
    backoffMultiplier: number
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`🔄 Attempt ${attempt}/${maxRetries} to get user details...`);
        this.logToFile(`🔄 Attempt ${attempt}/${maxRetries} to get user details...`);
        
        const result = await operation();
        this.logger.log(`✅ User details received on attempt ${attempt}`);
        this.logToFile(`✅ User details received on attempt ${attempt}`);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`❌ Attempt ${attempt} failed: ${lastError.message}`);
        this.logToFile(`❌ Attempt ${attempt} failed: ${lastError.message}`);
        
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
        this.logger.log(`⏳ Waiting ${delay}ms before retry...`);
        this.logToFile(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Sync/create user after Privy authentication
   * Frontend sends Privy token, we verify it and create/update user in our DB
   */
  @ApiOperation({ 
    summary: 'Sync user from Privy', 
    description: `Verify Privy token, create/update user in DB, sync all wallets, and return JWT token.
    
**⚠️ IMPORTANT**: You cannot create a Privy user directly in Swagger. Privy authentication happens on the frontend.
    
**To test this endpoint**:
1. Login via frontend app (connect wallet via Privy UI)
2. Get Privy token from browser console: \`await window.privy.getAccessToken()\`
3. Use that token in the \`privyToken\` field below
4. The response will include a JWT token - use that for other protected endpoints` 
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
      const userWallets = await this.retryWithBackoff(
        () => this.privyAuthService.getUserWallets((privyUser as any).userId),
        3, // max retries for wallets
        500, // initial delay 500ms
        2 // backoff multiplier
      );
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
        this.logger.log(`Debug: userDetails.wallet = ${JSON.stringify((userDetails as any).wallet)}`);
        this.logToFile(`Debug: userDetails.wallet = ${JSON.stringify((userDetails as any).wallet)}`);
        
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
          this.logger.warn(`⚠️ User ${email} has no Privy wallets - this might be a timing issue`);
          this.logToFile(`⚠️ User ${email} has no Privy wallets - this might be a timing issue`);
          
          // For ALL users (not just new users), try to get wallets again after a short delay
          this.logger.log(`Retrying wallet fetch for user after delay...`);
          this.logToFile(`Retrying wallet fetch for user after delay...`);
          
          // Wait 3 seconds and try again with more aggressive retry
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            const retryWallets = await this.retryWithBackoff(
              () => this.privyAuthService.getUserWallets((privyUser as any).userId),
              3, // more retries
              2000, // longer initial delay
              2
            );
            
            if (retryWallets && (retryWallets as any).length > 0) {
              this.logger.log(`✅ Retry successful: Found ${(retryWallets as any).length} wallets on retry`);
              this.logToFile(`✅ Retry successful: Found ${(retryWallets as any).length} wallets on retry`);
              
              // Sync the retry wallets
              for (const wallet of (retryWallets as any)) {
                this.logToFile(`Syncing retry wallet: ${(wallet as any).address} (${(wallet as any).chainType})`);
                await this.authService.syncPrivyWallet(user.id, {
                  privyWalletId: (wallet as any).id,
                  address: (wallet as any).address,
                  blockchain: this.mapChainType((wallet as any).chainType),
                  type: (wallet as any).id === 'embedded' ? 'PRIVY_EMBEDDED' : 'PRIVY_EXTERNAL',
                  walletClient: (wallet as any).walletClient || 'privy',
                  isPrimary: (retryWallets as any)[0].id === (wallet as any).id,
                });
              }
              this.logger.log(`✅ Synced ${(retryWallets as any).length} retry wallets for user: ${email}`);
              this.logToFile(`✅ Synced ${(retryWallets as any).length} retry wallets for user: ${email}`);
            } else {
              this.logger.warn(`⚠️ Retry also failed - no wallets found for user ${email}`);
              this.logToFile(`⚠️ Retry also failed - no wallets found for user ${email}`);
            }
          } catch (retryError) {
            this.logger.error(`❌ Retry failed: ${(retryError as any).message}`);
            this.logToFile(`❌ Retry failed: ${(retryError as any).message}`);
          }
        }
      }

      // Note: Aptos wallet creation is now manual via dashboard button
      this.logger.log('Step 6: Skipping automatic Aptos wallet creation (now manual)');
      this.logToFile('Step 6: Skipping automatic Aptos wallet creation (now manual)');

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
      this.logToFile(`Wallets being returned: ${JSON.stringify(response.wallets)}`);
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
      'aptos': 'MOVEMENT', // Movement wallets are detected as 'aptos' chainType (Aptos-compatible)
      'movement': 'MOVEMENT',
    };
    return mapping[chainType?.toLowerCase()] || 'UNKNOWN';
  }

  /**
   * Get current Privy user info (protected route)
   * Uses JWT token from /sync endpoint to get user's Privy details
   */
  @ApiOperation({ 
    summary: 'Get current user info', 
    description: 'Get Privy user details and wallets (requires JWT token from /sync endpoint)' 
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 200, description: 'User info retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: any) {
    // Get user from JWT token (set by JwtAuthGuard)
    const userId = req.user.userId;
    const user = await this.authService.getUserById(userId);
    
    if (!user || !user.privyUserId) {
      throw new UnauthorizedException('User not found or no Privy ID');
    }
    
    // Get Privy user details using stored Privy user ID
    const userDetails = await this.privyAuthService.getUserById(user.privyUserId);
    const wallets = await this.privyAuthService.getUserWallets(user.privyUserId);
    
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        privyUserId: user.privyUserId,
      },
      privyUser: userDetails,
      wallets: wallets,
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

  /**
   * Create Aptos wallet for user (Manual creation from dashboard)
   */
  @Post('create-aptos-wallet')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Create Aptos wallet (Manual)', 
    description: 'Create a server-generated Aptos wallet for payments on Aptos chain - called from user dashboard' 
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Aptos wallet created successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        address: { type: 'string' },
        message: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'User already has Aptos wallet' })
  @ApiResponse({ status: 500, description: 'Failed to create Aptos wallet' })
  async createAptosWalletManual(@Request() req: any) {
    try {
      const userId = req.user.userId;
      
      // Check if user already has an Aptos wallet
      const existingWallet = await this.aptosWalletService.getAptosAccount(userId);
      if (existingWallet) {
        return {
          success: false,
          message: 'User already has an Aptos wallet',
          address: existingWallet.accountAddress.toString()
        };
      }
      
      // Create new Aptos wallet
      const aptosWallet = await this.aptosWalletService.createAptosWallet(userId);
      
      this.logger.log(`✅ Aptos wallet created for user ${userId}: ${aptosWallet.address}`);
      
      return {
        success: true,
        address: aptosWallet.address,
        message: 'Aptos wallet created successfully'
      };
    } catch (error) {
      this.logger.error('Failed to create Aptos wallet:', error);
      return { 
        success: false, 
        message: `Failed to create Aptos wallet: ${(error as any).message}` 
      };
    }
  }

  /**
   * Get user wallets
   */
  @Get('wallets')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Get user wallets', 
    description: 'Get all wallets for the authenticated user' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'User wallets retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        wallets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              address: { type: 'string' },
              blockchain: { type: 'string' },
              walletClient: { type: 'string' },
              isPrimary: { type: 'boolean' }
            }
          }
        }
      }
    }
  })
  async getUserWallets(@Request() req: any) {
    try {
      const userId = req.user.userId;
      
      // Get user wallets from database
      const wallets = await this.authService.getUserWallets(userId);
      
      this.logger.log(`Retrieved ${wallets.length} wallets for user ${userId}`);
      
      return {
        success: true,
        wallets: wallets.map(wallet => ({
          id: wallet.id,
          address: wallet.address,
          blockchain: wallet.blockchain,
          walletClient: wallet.walletClient,
          isPrimary: wallet.isPrimary
        }))
      };
    } catch (error) {
      this.logger.error('Failed to get user wallets:', error);
      return { 
        success: false, 
        message: `Failed to get wallets: ${(error as any).message}` 
      };
    }
  }

  /**
   * Manually sync user wallets from Privy
   */
  @Post('sync-wallets')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Sync user wallets from Privy', 
    description: 'Manually sync all wallets from Privy API for the authenticated user' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Wallets synced successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        syncedCount: { type: 'number' }
      }
    }
  })
  async syncUserWallets(@Request() req: any) {
    try {
      const userId = req.user.userId;
      const user = await this.authService.getUserById(userId);
      
      if (!user || !user.privyUserId) {
        return {
          success: false,
          message: 'User not found or no Privy ID'
        };
      }

      this.logger.log(`🔄 Manually syncing wallets for user ${userId} (Privy ID: ${user.privyUserId})`);
      
      // Get user details from Privy
      const userDetails = await this.privyAuthService.getUserById(user.privyUserId);
      const userWallets = await this.privyAuthService.getUserWallets(user.privyUserId);
      
      this.logger.log(`📊 Privy API returned ${(userWallets as any)?.length || 0} wallets`);
      
      let syncedCount = 0;
      
      if (userWallets && (userWallets as any).length > 0) {
        for (const wallet of (userWallets as any)) {
          this.logger.log(`🔄 Syncing wallet: ${(wallet as any).address} (${(wallet as any).chainType})`);
          await this.authService.syncPrivyWallet(userId, {
            privyWalletId: (wallet as any).id,
            address: (wallet as any).address,
            blockchain: this.mapChainType((wallet as any).chainType),
            type: (wallet as any).id === 'embedded' ? 'PRIVY_EMBEDDED' : 'PRIVY_EXTERNAL',
            walletClient: (wallet as any).walletClient || 'privy',
            isPrimary: (userWallets as any)[0].id === (wallet as any).id,
          });
          syncedCount++;
        }
      } else if ((userDetails as any).wallet?.address) {
        // Fallback to user.wallet if no wallets array
        this.logger.log(`🔄 Creating wallet from user.wallet: ${(userDetails as any).wallet.address}`);
        await this.authService.syncPrivyWallet(userId, {
          privyWalletId: 'embedded',
          address: (userDetails as any).wallet.address,
          blockchain: 'ETHEREUM',
          type: 'PRIVY_EMBEDDED',
          walletClient: 'privy',
          isPrimary: true,
        });
        syncedCount++;
      }
      
      this.logger.log(`✅ Synced ${syncedCount} wallets for user ${userId}`);
      
      return {
        success: true,
        message: `Successfully synced ${syncedCount} wallets`,
        syncedCount
      };
    } catch (error) {
      this.logger.error('Failed to sync user wallets:', error);
      return { 
        success: false, 
        message: `Failed to sync wallets: ${(error as any).message}` 
      };
    }
  }
}


