import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CircleService } from './circle.service';
import { CircleCreateUserDto, CircleLoginDto, CircleUserTokenDto, CreateWalletDto, ForgotPasswordDto, InitializeUserDto } from './dto/circle.dto';

@ApiTags('circle')
@Controller('circle')
export class CircleController {
  constructor(private readonly circle: CircleService) {}

  @Post('users')
  @ApiOperation({ 
    summary: 'Create or continue a Circle user',
    description: 'Create a new Circle user or continue existing user session. Persists user identity to database.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'User created or continued successfully',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        userToken: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  async createUser(@Body() dto: CircleCreateUserDto) {
    return this.circle.createOrContinueUser(dto);
  }

  @Post('users/login')
  @ApiOperation({ 
    summary: 'Login with Circle credentials',
    description: 'Login with stored Circle credentials. Returns backend JWT token for authenticated requests.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        user: { type: 'object' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: CircleLoginDto) {
    return this.circle.login(dto);
  }

  @Post('users/forgot-password')
  @ApiOperation({ summary: 'Reset local password for a Circle-linked account' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.circle.forgotPassword(dto);
  }

  @Post('users/token')
  @ApiOperation({ summary: 'Get Circle userToken for user (ephemeral)' })
  async userToken(@Body() dto: CircleUserTokenDto) {
    return this.circle.getUserToken(dto.userId);
  }

  @Post('users/initialize')
  @ApiOperation({ summary: 'Initialize user for PIN setup (returns challengeId if required)' })
  async initializeUser(@Body() dto: InitializeUserDto) {
    return this.circle.initializeUser(dto);
  }

  @Post('wallets')
  @ApiOperation({ summary: 'Create wallet for user; handles PIN challenge flow; persists wallet' })
  async createWallet(@Body() dto: CreateWalletDto) {
    return this.circle.createWallet(dto);
  }

  @Get('users/:userId/wallets')
  @ApiOperation({ 
    summary: "List user's wallets",
    description: "Get all wallets for a Circle user and sync them to database. Returns wallet list with balances."
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Wallets retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          walletId: { type: 'string' },
          address: { type: 'string' },
          balances: { type: 'array' }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async listWallets(@Param('userId') userId: string) {
    return this.circle.listWallets(userId);
  }

  @Get('wallets/:walletId/balances')
  @ApiOperation({ 
    summary: 'Get wallet balances',
    description: 'Get token balances for a Circle wallet. Returns USDC and other token balances.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Balances retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        tokenBalances: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              token: { type: 'object' },
              amount: { type: 'string' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async balances(@Param('walletId') walletId: string, @Query('userId') userId: string) {
    return this.circle.getBalances(userId, walletId);
  }

  @Get('wallets/:walletId/transactions')
  @ApiOperation({ summary: 'Get wallet transactions for user' })
  async transactions(@Param('walletId') walletId: string, @Query('userId') userId: string) {
    return this.circle.getTransactions(userId, walletId);
  }

  @Get('transactions/recent')
  @ApiOperation({ summary: 'Check for recent transactions (for bridge monitoring)' })
  async checkRecentTransactions(@Query('userId') userId: string) {
    return this.circle.checkRecentTransactions(userId);
  }
}