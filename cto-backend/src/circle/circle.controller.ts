import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CircleService } from './circle.service';
import { CircleCreateUserDto, CircleLoginDto, CircleUserTokenDto, CreateWalletDto, ForgotPasswordDto, InitializeUserDto } from './dto/circle.dto';

@ApiTags('circle')
@Controller('circle')
export class CircleController {
  constructor(private readonly circle: CircleService) {}

  @Post('users')
  @ApiOperation({ summary: 'Create or continue a Circle user; persist identity to DB' })
  @ApiResponse({ status: 200 })
  async createUser(@Body() dto: CircleCreateUserDto) {
    return this.circle.createOrContinueUser(dto);
  }

  @Post('users/login')
  @ApiOperation({ summary: 'Login with stored credentials; returns backend JWT token' })
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
  @ApiOperation({ summary: "List user's wallets and sync to DB" })
  async listWallets(@Param('userId') userId: string) {
    return this.circle.listWallets(userId);
  }

  @Get('wallets/:walletId/balances')
  @ApiOperation({ summary: 'Get wallet balances for user' })
  async balances(@Param('walletId') walletId: string, @Query('userId') userId: string) {
    return this.circle.getBalances(userId, walletId);
  }

  @Get('wallets/:walletId/transactions')
  @ApiOperation({ summary: 'Get wallet transactions for user' })
  async transactions(@Param('walletId') walletId: string, @Query('userId') userId: string) {
    return this.circle.getTransactions(userId, walletId);
  }
}