import { Controller, Post, Body, Get, UseGuards, Request, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
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
            walletId: { type: 'string', nullable: true, example: 'cmhx1234567890' },
            role: { type: 'string', example: 'USER' },
            privyUserId: { type: 'string', example: 'did:privy:...' },
            walletsCount: { type: 'number', example: 3 },
            avatarUrl: { type: 'string', nullable: true, example: 'https://example.com/avatar.png' },
            wallets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  address: { type: 'string' },
                  blockchain: { type: 'string' },
                  walletClient: { type: 'string' },
                  isPrimary: { type: 'boolean' }
                }
              }
            }
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
      
      const privyUser = await this.privyAuthService.verifyToken(privyToken);
      const privyUserId = (privyUser as any).userId;
      this.logger.log(`✅ Token verified for Privy ID: ${privyUserId}`);

      const userDetails = await this.privyAuthService.getUserById(privyUserId);
      let userWallets = await this.privyAuthService.getUserWallets(privyUserId);
      
      // Safety retry: If no wallets found, wait 1s and try once more
      if (!userWallets || userWallets.length === 0) {
        this.logger.log(`⏳ No wallets found initially for ${privyUserId}, waiting 1s for Privy indexing...`);
        await new Promise(r => setTimeout(r, 1000));
        userWallets = await this.privyAuthService.getUserWallets(privyUserId);
      }
      
      this.logger.log(`📊 Privy API returned ${(userWallets as any)?.length || 0} wallets for ${privyUserId}`);
      this.logToFile(`📊 Privy API returned ${JSON.stringify(userWallets)}`);
      
      // Resolve email
      let email: string;
      if ((userDetails as any).email?.address) {
        email = (userDetails as any).email.address;
      } else if ((userDetails as any).google?.email) {
        email = (userDetails as any).google.email;
      } else if (userWallets && (userWallets as any).length > 0) {
        email = `${(userWallets as any)[0].address}@wallet.privy`;
      } else {
        email = `privy-${privyUserId}@ctomemes.xyz`;
      }
      
      this.logger.log(`📧 Resolved email: ${email}`);

      // Find or create user
      let user = await this.authService.findByEmail(email);
      if (!user) {
        this.logger.log(`🆕 Creating NEW user: ${email}`);
        user = await this.authService.register({
          email,
          password: `privy-${privyUserId}`,
        });
      }

      // Update Privy IDs
      await this.authService.updateUser(user.id, {
        privyUserId: privyUserId,
        privyDid: (userDetails as any).id,
        lastLoginAt: new Date(),
      });

      // SYNC WALLETS - CRITICAL SECTION
      let syncedCount = 0;
      if (userWallets && (userWallets as any).length > 0) {
        for (const wallet of (userWallets as any)) {
          const blockchain = this.mapChainType((wallet as any).chainType);
          this.logger.log(`🔄 Syncing wallet: ${(wallet as any).address} on ${blockchain}`);
          
          await this.authService.syncPrivyWallet(user.id, {
            privyWalletId: (wallet as any).id,
            address: (wallet as any).address,
            blockchain: blockchain,
            type: (wallet as any).type || ((wallet as any).id === 'embedded' || (wallet as any).connectorType === 'embedded' ? 'PRIVY_EMBEDDED' : 'PRIVY_EXTERNAL'),
            walletClient: (wallet as any).walletClient || 'privy',
            isPrimary: syncedCount === 0,
          });
          syncedCount++;
        }
      } else {
        this.logger.warn(`⚠️ No wallets found in Privy API for user ${user.id}`);
      }

      const jwtToken = await this.authService.login(user);
      const userFull = await this.authService.getUserById(user.id);
      
      this.logger.log(`✅ SYNC COMPLETE for user ${user.id}. Total wallets in DB: ${(userFull as any).wallets?.length || 0}`);
      
      return {
        success: true,
        user: {
          ...userFull,
          privyUserId
        },
        token: jwtToken.access_token,
        wallets: (userFull as any).wallets
      };
    } catch (error) {
      this.logger.error(`❌ Sync failed: ${error.message}`, error.stack);
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
   * ⚠️ This endpoint verifies PRIVY tokens, not JWT tokens!
   * Use this to check if a Privy access token (from frontend) is still valid.
   * JWT tokens are automatically verified by JWT guards on protected endpoints.
   */
  @ApiOperation({ 
    summary: 'Verify Privy token', 
    description: `Check if a Privy access token is valid.
    
**⚠️ CRITICAL**: This endpoint verifies **Privy tokens** (ES256 algorithm), NOT JWT tokens (HS256 algorithm)!

**How to identify token types:**
- **Privy Token** (ES256): Starts with \`eyJhbGciOiJFUzI1NiIs...\` (decodes to \`{"alg":"ES256"...}\`)
  - Get from: Browser cookies (\`privy-token\`) or \`await window.privy.getAccessToken()\`
  - Used for: \`/api/auth/privy/verify\`, \`/api/auth/privy/sync\`
  
- **JWT Token** (HS256): Starts with \`eyJhbGciOiJIUzI1NiIs...\` (decodes to \`{"alg":"HS256"...}\`)
  - Get from: Response of \`/api/auth/privy/sync\` or \`/api/auth/login\`
  - Used for: All other protected endpoints (\`/me\`, \`/wallets\`, etc.)
  - ❌ **DO NOT** use JWT tokens with this endpoint - they will be rejected!

**Example Privy Token** (from browser console):
\`eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ.eyJzaWQiOiJjbWh4NTZrem0wMGlpa3cwYzltYjdiYmprIiwiaXNzIjoicHJpdnkuaW8iLCJpYXQiOjE3NjMwMjA5OTksImF1ZCI6ImNtZ3Y3NzIxczAwczNsNzBjcGNpMmUyc2EiLCJzdWIiOiJkaWQ6cHJpdnk6Y21oeDU2bDExMDBpa2t3MGN5ZGF4NzdrMiIsImV4cCI6MTc2MzAyNDU5OX0...\`

**Testing in Swagger:**
1. Login via frontend (https://www.ctomarketplace.com)
2. Open browser DevTools → Application → Cookies
3. Copy the \`privy-token\` cookie value
4. Paste it here (NOT the JWT token from /sync response)` 
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Privy access token (ES256) - Get from browser cookies or getAccessToken(). NOT JWT token!',
          example: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkxrZjVwSjNHSVdKUFdXcU16VlN4OG5FeURzVVRhcVg4aGtTLUYtZ3hFVU0ifQ...'
        }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Token verification result',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', example: true },
        userId: { type: 'string', example: 'did:privy:cmhx...' },
        claims: { type: 'object' }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Invalid token',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', example: false },
        error: { type: 'string', example: 'Invalid Privy authentication token' }
      }
    }
  })
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
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Create Aptos wallet (Manual)', 
    description: `Create a server-generated Aptos wallet for payments on Aptos chain - called from user dashboard.

**Authentication Required**: JWT token (from /sync response)

**Note**: This endpoint is deprecated - Movement wallets are now created automatically via Privy.` 
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
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
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
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get user wallets', 
    description: `Get all wallets for the authenticated user.

**Authentication Required**: JWT token (from /sync response)

**Steps to test:**
1. Call \`/api/auth/privy/sync\` with Privy token to get JWT token
2. Click "Authorize" button at top of Swagger page
3. Enter JWT token in format: \`Bearer <your-jwt-token>\` or just paste the token
4. Click "Authorize" then "Close"
5. Now execute this endpoint` 
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
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
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
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Sync user wallets from Privy', 
    description: `Manually sync all wallets from Privy API for the authenticated user.

**Authentication Required**: JWT token (from /sync response)

**Steps to test:**
1. Call \`/api/auth/privy/sync\` with Privy token to get JWT token
2. Click "Authorize" button at top of Swagger page
3. Enter JWT token in format: \`Bearer <your-jwt-token>\` or just paste the token
4. Click "Authorize" then "Close"
5. Now execute this endpoint` 
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
  @ApiResponse({ status: 401, description: 'Unauthorized - JWT token required' })
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

      this.logger.log(`🔄 Manual sync for user ${userId} (${user.privyUserId})`);
      
      const userDetails = await this.privyAuthService.getUserById(user.privyUserId);
      let userWallets = await this.privyAuthService.getUserWallets(user.privyUserId);
      
      // Retry logic for manual sync too
      if (!userWallets || userWallets.length === 0) {
        this.logger.log(`⏳ No wallets for ${userId}, retrying once...`);
        await new Promise(r => setTimeout(r, 1500));
        userWallets = await this.privyAuthService.getUserWallets(user.privyUserId);
      }

      this.logger.log(`📊 Privy API returned ${(userWallets as any)?.length || 0} wallets`);
      
      let syncedCount = 0;
      if (userWallets && (userWallets as any).length > 0) {
        for (const wallet of (userWallets as any)) {
          const blockchain = this.mapChainType((wallet as any).chainType);
          await this.authService.syncPrivyWallet(userId, {
            privyWalletId: (wallet as any).id,
            address: (wallet as any).address,
            blockchain: blockchain,
            type: (wallet as any).type,
            walletClient: (wallet as any).walletClient,
            isPrimary: syncedCount === 0,
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


