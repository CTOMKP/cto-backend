import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import axios, { AxiosRequestHeaders } from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CircleCreateUserDto, CircleLoginDto, CreateWalletDto, ForgotPasswordDto, InitializeUserDto } from './dto/circle.dto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CircleService {
  private base = process.env.CIRCLE_API_BASE || 'https://api.circle.com/v1/w3s';
  private apiKey = process.env.CIRCLE_API_KEY || '';
  private appId = process.env.CIRCLE_APP_ID || '';

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  private headers(userToken?: string): AxiosRequestHeaders {
    const h: AxiosRequestHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    } as any;
    if (userToken) (h as any)['X-User-Token'] = userToken;
    return h;
  }

  async createOrContinueUser({ userId, email, password }: CircleCreateUserDto) {
    // create or update local user with hashed password
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.upsert({
      where: { email },
      create: { email, name: null, passwordHash },
      update: { passwordHash },
    });

    // Try fetch existing Circle user
    try {
      const existing = await axios.get(`${this.base}/users/${userId}`, { headers: this.headers() });
      const c = existing.data?.data;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { circleUserId: c.id, circlePinStatus: c.pinStatus ?? null, circleAppId: this.appId },
      });
      return {
        success: true,
        message: 'User exists - continuing signup',
        user: { id: user.id, email: user.email, circleUserId: c.id, pinStatus: c.pinStatus ?? null },
        requiresWalletCreation: true,
      };
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        // non-404 errors are logged but we continue to creation attempt
        // fallthrough to creation
      }
    }

    // Create Circle user
    const created = await axios.post(
      `${this.base}/users`,
      { userId },
      { headers: this.headers() },
    );
    const c = created.data?.data;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { circleUserId: c.id, circlePinStatus: c.pinStatus ?? null, circleAppId: this.appId },
    });

    return {
      success: true,
      message: 'User created successfully',
      user: { id: user.id, email: user.email, circleUserId: c.id, pinStatus: c.pinStatus ?? null },
      requiresWalletCreation: true,
    };
  }

  async login({ userId, password }: CircleLoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = this.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '7d' });

    return { success: true, user: { userId: user.email, email: user.email }, token };
  }

  async forgotPassword({ userId, newPassword }: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) throw new BadRequestException('User not found');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { success: true };
  }

  async getUserToken(userId: string) {
    const resp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() },
    );
    const { userToken, encryptionKey } = resp.data?.data || {};
    if (!userToken) throw new BadRequestException('Failed to get userToken from Circle');
    return { success: true, data: { userToken, encryptionKey, userId } };
  }

  // Explicit user initialization for PIN setup, mirrors server(1).js behavior
  async initializeUser({ userId, userToken, blockchain = 'APTOS' }: InitializeUserDto) {
    // Ensure we have a fresh user token if one was not provided
    let token = userToken;
    if (!token) {
      const tokenResp = await axios.post(
        `${this.base}/users/token`,
        { userId },
        { headers: this.headers() },
      );
      token = tokenResp.data?.data?.userToken;
      if (!token) throw new BadRequestException('Failed to get fresh userToken');
    }

    const headersWithUser = this.headers(token);
    const chain = blockchain === 'APTOS' ? 'APTOS-TESTNET' : blockchain;

    const init = await axios.post(
      `${this.base}/user/initialize`,
      {
        accountType: 'EOA',
        blockchains: [chain],
        idempotencyKey: uuidv4(),
      },
      { headers: headersWithUser },
    );

    const challengeId = init.data?.data?.challengeId;
    if (challengeId) {
      return {
        success: true,
        message: 'PIN setup required before wallet creation',
        challengeId,
        requiresPinSetup: true,
      };
    }

    return { success: true, data: init.data?.data };
  }

  async createWallet({ userId, description, blockchain = 'APTOS' }: CreateWalletDto) {
    const tokenResp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() },
    );
    const freshUserToken = tokenResp.data?.data?.userToken;
    if (!freshUserToken) throw new BadRequestException('Failed to obtain user token');

    const headersWithUser = this.headers(freshUserToken);
    const chain = blockchain === 'APTOS' ? 'APTOS-TESTNET' : blockchain;

    try {
      const resp = await axios.post(
        `${this.base}/user/wallets`,
        {
          userId,
          blockchains: [chain],
          count: 1,
          walletSetId: `wallet-set-${userId}-${Date.now()}`,
          idempotencyKey: uuidv4(),
        },
        { headers: headersWithUser },
      );

      const wallets = resp.data?.data?.wallets || [];
      if (wallets.length > 0) {
        const w = wallets[0];
        const owner = await this.prisma.user.findUnique({ where: { email: userId } });
        if (owner) {
          await this.prisma.wallet.upsert({
            where: { circleWalletId: w.id },
            create: {
              circleWalletId: w.id,
              address: w.address || '',
              userId: owner.id,
              blockchain: 'APTOS',
              type: 'USER_CONTROLLED',
              description: description || `Wallet for ${userId}`,
            },
            update: {
              address: w.address || '',
              description: description || `Wallet for ${userId}`,
            },
          });
        }
        return {
          success: true,
          data: {
            id: w.id,
            address: w.address || '',
            type: 'USER_CONTROLLED',
            blockchain: chain,
            description: description || `Wallet for ${userId}`,
            createDate: new Date().toISOString(),
          },
          message: 'Wallet created successfully',
        };
      }

      if (resp.data?.data?.challengeId) {
        return {
          success: true,
          data: { challengeId: resp.data.data.challengeId, requiresPinSetup: true },
          message: 'PIN setup required before wallet creation',
        };
      }

      return { success: true, data: resp.data?.data, message: 'Wallet creation response received' };
    } catch (err: any) {
      if (err?.response?.data?.code === 155110) {
        // Initialize for PIN setup
        const init = await axios.post(
          `${this.base}/user/initialize`,
          {
            accountType: 'EOA',
            blockchains: [chain],
            idempotencyKey: uuidv4(),
          },
          { headers: headersWithUser },
        );
        if (init.data?.data?.challengeId) {
          return {
            success: true,
            message: 'PIN setup required before wallet creation',
            challengeId: init.data.data.challengeId,
            requiresPinSetup: true,
          };
        }
      }
      throw err;
    }
  }

  async listWallets(userId: string) {
    const tokenResp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() },
    );
    const freshUserToken = tokenResp.data?.data?.userToken;

    let walletsResp;
    try {
      walletsResp = await axios.get(`${this.base}/users/${userId}/wallets`, { headers: this.headers(freshUserToken) });
    } catch {
      walletsResp = await axios.get(`${this.base}/wallets`, { headers: this.headers(freshUserToken) });
    }

    const raw = walletsResp.data?.data?.wallets || [];
    const owner = await this.prisma.user.findUnique({ where: { email: userId } });
    const normalized = [] as any[];

    for (const w of raw) {
      normalized.push({
        id: w.id,
        address: w.address || '',
        type: 'USER_CONTROLLED',
        blockchain: w.blockchain || 'APTOS-TESTNET',
        description: w.name || `Wallet for ${userId}`,
        createDate: w.createDate || new Date().toISOString(),
      });
      if (owner) {
        await this.prisma.wallet.upsert({
          where: { circleWalletId: w.id },
          create: {
            circleWalletId: w.id,
            address: w.address || '',
            userId: owner.id,
            blockchain: 'APTOS',
            type: 'USER_CONTROLLED',
            description: w.name || `Wallet for ${userId}`,
          },
          update: { address: w.address || '', description: w.name || `Wallet for ${userId}` },
        });
      }
    }

    return { success: true, wallets: normalized, message: 'User wallets retrieved successfully' };
  }

  async getBalances(userId: string, walletId: string) {
    const tokenResp = await axios.post(
      `${this.base}/users/token`,
      { userId },
      { headers: this.headers() },
    );
    const freshUserToken = tokenResp.data?.data?.userToken;

    const resp = await axios.get(`${this.base}/wallets/${walletId}/balances`, { headers: this.headers(freshUserToken) });
    const tokenBalances = resp.data?.data?.tokenBalances || [];
    const balances = tokenBalances.map((b: any) => {
      const amount = parseFloat(b.amount || '0');
      const symbol = b.token?.symbol || 'UNKNOWN';
      let usdValue = 0;
      if (amount > 0) {
        if (symbol === 'USDC') usdValue = amount;
        else if (symbol === 'APT') usdValue = amount * 10; // placeholder pricing
        else usdValue = amount;
      }
      return { asset: symbol, balance: b.amount || '0', decimals: b.decimals || 0, symbol, usdValue: usdValue.toFixed(2), token: b.token };
    });

    return { success: true, data: balances, balances };
  }

  async getTransactions(userId: string, walletId: string) {
    try {
      // Fresh user token per request
      const tokenResp = await axios.post(
        `${this.base}/users/token`,
        { userId },
        { headers: this.headers() },
      );
      const freshUserToken = tokenResp.data?.data?.userToken;
      if (!freshUserToken) throw new BadRequestException('Failed to obtain user token');

      // Try different Circle API endpoints for transactions
      let resp;
      try {
        // First try the standard wallet transactions endpoint
        resp = await axios.get(`${this.base}/wallets/${walletId}/transactions`, {
          headers: this.headers(freshUserToken),
        });
      } catch (firstError: any) {
        // If that fails, try the user transactions endpoint
        try {
          resp = await axios.get(`${this.base}/users/${userId}/transactions`, {
        headers: this.headers(freshUserToken),
      });
        } catch (secondError: any) {
          // If both fail, return empty array (wallet might be new with no transactions)
          console.log('No transactions found for wallet:', walletId);
          return { success: true, data: [], transactions: [], message: 'No transactions found' };
        }
      }

      const raw = resp.data?.data?.transactions || resp.data?.data || [];
      const txs = (raw || []).map((t: any) => ({
        id: t.id || t.transactionId || t.hash || `${walletId}-${t.createDate || t.timestamp || Date.now()}`,
        txHash: t.txHash || t.hash || '',
        status: t.status || 'UNKNOWN',
        direction: t.direction || t.type || 'UNKNOWN',
        amount: t.amount || t.value || '0',
        symbol: t.token?.symbol || t.asset || t.symbol || 'UNKNOWN',
        fromAddress: t.fromAddress || t.from || '',
        toAddress: t.toAddress || t.to || '',
        createDate: t.createDate || t.timestamp || new Date().toISOString(),
      }));

      return { success: true, data: txs, transactions: txs };
    } catch (e: any) {
      // If it's a 404 or similar, just return empty array (new wallet)
      if (e?.response?.status === 404 || e?.response?.status === 400) {
        console.log('Wallet has no transactions yet:', walletId);
        return { success: true, data: [], transactions: [], message: 'No transactions found' };
      }
      
      // For other errors, log and return empty array
      console.error('Circle transactions error:', e?.response?.data || e?.message);
      return { success: true, data: [], transactions: [], message: 'Failed to fetch transactions' };
    }
  }

  // Check for recent transactions (for bridge monitoring)
  async checkRecentTransactions(userId: string) {
    try {
      // Get user's wallets
      const user = await this.prisma.user.findUnique({ where: { email: userId } });
      if (!user) throw new Error('User not found');

      const wallets = await this.prisma.wallet.findMany({
        where: { userId: user.id }
      });

      if (wallets.length === 0) {
        return { success: true, data: [], hasNewTransactions: false };
      }

      // Check the most recent wallet for new transactions
      const latestWallet = wallets[wallets.length - 1];
      const transactions = await this.getTransactions(userId, latestWallet.id);
      
      // Filter for transactions from the last 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentTransactions = transactions.data.filter((tx: any) => {
        const txDate = new Date(tx.createDate);
        return txDate > tenMinutesAgo;
      });

      return { 
        success: true, 
        data: recentTransactions, 
        hasNewTransactions: recentTransactions.length > 0,
        walletId: latestWallet.id,
        walletAddress: latestWallet.address
      };
    } catch (error: any) {
      console.error('Error checking recent transactions:', error);
      return { success: false, data: [], hasNewTransactions: false };
    }
  }
}