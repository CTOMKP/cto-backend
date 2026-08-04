import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { XpService } from '../xp/xp.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Select fields that exist in the database
  // Note: bio column exists in DB, but Prisma client must be regenerated after column is added
  private readonly userSelect = {
    id: true,
    name: true,
    email: true,
    passwordHash: true,
    role: true,
    provider: true,
    providerId: true,
    circleUserId: true,
    circleAppId: true,
    circlePinStatus: true,
    privyUserId: true,
    privyDid: true,
    lastLoginAt: true,
    avatarUrl: true,
    bio: true,
    xpBalance: true,
    rankScore: true,
    rankTier: true,
    currentStreakDays: true,
    lastLoginDate: true,
    createdAt: true,
    updatedAt: true,
    wallets: {
      orderBy: {
        isPrimary: 'desc' as const
      }
    }
  }; // Removed 'as const' to prevent strict type requirements on every DB operation

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly xpService: XpService,
  ) {}

  // Validate user by email and password against DB
  async validateUser(email: string, password: string): Promise<any> {
    this.logger.log(`🔍 [AuthService] validateUser called for email: ${email}`);
    
    const user = await this.prisma.user.findUnique({ 
      where: { email },
      select: this.userSelect
    });
    
    if (!user) {
      this.logger.warn(`❌ [AuthService] User not found for email: ${email}`);
      return null;
    }
    
    if (!user.passwordHash) {
      this.logger.warn(`❌ [AuthService] User ${email} has no password hash (social login user)`);
      return null; // Circle/social users may not have a password
    }
    
    this.logger.log(`🔍 [AuthService] User found: ${email}, comparing password...`);
    this.logger.debug(`🔍 [AuthService] Password length: ${password.length}, Hash preview: ${user.passwordHash.substring(0, 20)}...`);
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    
    if (!valid) {
      this.logger.warn(`❌ [AuthService] Password comparison failed for ${email}`);
      // Test if it's a hash format issue
      this.logger.debug(`🔍 [AuthService] Hash length: ${user.passwordHash.length}, Hash format: ${user.passwordHash.substring(0, 7)}`);
      return null;
    }
    
    this.logger.log(`✅ [AuthService] Password verified successfully for ${email}`);
    const { passwordHash, ...result } = user as any;
    return result;
  }

  // Register a new user with hashed password
  async register(data: { email: string; password: string; name?: string; walletAddress?: string }) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const created = await this.prisma.user.create({
        data: { 
          name: data.name ?? null, 
          email: data.email, 
          passwordHash 
        },
      });
      await this.xpService.awardSignup(created.id);
      const { passwordHash: _, ...safe } = created as any;
      return safe;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Email already in use');
      }
      throw e;
    }
  }

  // Create or fetch a Google OAuth user and issue JWTs
  async loginOrCreateGoogle(email: string, providerId: string) {
    // Normalize providerId to string to avoid scientific notation issues
    const providerIdStr = String(providerId);

    // Try to find by email first
    let user = await this.prisma.user.findUnique({ 
      where: { email },
      select: this.userSelect
    });

    if (!user) {
      // Try to find by providerId if email is not found
      user = await this.prisma.user.findFirst({ 
        where: { provider: 'google', providerId: providerIdStr },
        select: this.userSelect
      });
    }

    if (!user) {
      // Create new user with provider fields and a placeholder password hash
      const placeholderPassword = await bcrypt.hash('google_oauth_user', 10);
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: placeholderPassword,
          provider: 'google',
          providerId: providerIdStr,
          lastLoginAt: new Date(),
        },
        include: { wallets: true } // Include wallets so it matches the expected type
      });
    } else {
      // Ensure provider fields are set for existing users
      if (!user.provider || !user.providerId) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { provider: 'google', providerId: providerIdStr },
          include: { wallets: true } // Include wallets so it matches the expected type
        });
      }
      // Update last login timestamp on Google auth
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: { wallets: true } // Include wallets so it matches the expected type
      });
    }

    return this.login(user);
  }

  // Get user by id
  async getUserById(id: number) {
    return this.prisma.user.findUnique({ 
      where: { id },
      select: this.userSelect
    });
  }

  // Get user by email
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ 
      where: { email },
      select: this.userSelect
    });
  }

  // Get user by Privy user ID
  async findByPrivyUserId(privyUserId: string) {
    return this.prisma.user.findUnique({ 
      where: { privyUserId },
      select: this.userSelect
    });
  }

  // Get user wallets
  async getUserWallets(userId: number) {
    return this.prisma.wallet.findMany({ 
      where: { userId },
      orderBy: { isPrimary: 'desc' }
    });
  }

  // Issue access and refresh tokens
  async login(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '24h' }); // Extended for testing
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    await this.xpService.awardDailyLogin(user.id);
    const rewardProgress = await this.xpService.getUserProgress(user.id);

    const moveWallet = user.wallets?.find((w: any) => 
      w.blockchain?.toString().toUpperCase() === 'MOVEMENT' || 
      w.blockchain?.toString().toUpperCase() === 'APTOS'
    );

    const { passwordHash: _, ...safeUser } = user as any;
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 86400, // 24 hours
      user: { 
        ...safeUser,
        xpBalance: rewardProgress.xpBalance,
        rankScore: rewardProgress.rankScore,
        rankTier: rewardProgress.rankTier,
        rankLevel: rewardProgress.rankLevel,
        rankLabel: rewardProgress.rankLabel,
        rankEmoji: rewardProgress.rankEmoji,
        nextRankTier: rewardProgress.nextRankTier,
        nextRankLevel: rewardProgress.nextRankLevel,
        nextRankLabel: rewardProgress.nextRankLabel,
        rankProgressPercent: rewardProgress.progressPercent,
        currentStreakDays: rewardProgress.currentStreakDays,
        walletId: moveWallet?.id || null, // Primary Movement wallet ID
        wallets: user.wallets || [], // Full list of wallets
      },
    };
  }

  async createSessionHandoff(userId: number, target: string) {
    if (!['creator', 'marketplace'].includes(target)) {
      throw new Error('Unsupported session handoff target');
    }

    const code = randomBytes(32).toString('base64url');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 60_000);

    await this.prisma.authHandoff.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.authHandoff.create({
      data: { codeHash, target, userId, expiresAt },
    });

    return { code, expiresAt: expiresAt.toISOString() };
  }

  async exchangeSessionHandoff(code: string, target: string) {
    if (!code || !['creator', 'marketplace'].includes(target)) return null;

    const codeHash = createHash('sha256').update(code).digest('hex');
    const now = new Date();
    const handoff = await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.authHandoff.findUnique({ where: { codeHash } });
      if (!candidate || candidate.target !== target || candidate.usedAt || candidate.expiresAt <= now) {
        return null;
      }
      const claimed = await tx.authHandoff.updateMany({
        where: { id: candidate.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      return claimed.count === 1 ? candidate : null;
    });

    if (!handoff) return null;
    const user = await this.getUserById(handoff.userId);
    return user ? this.login(user) : null;
  }

  // Refresh access token
  async refreshToken(user: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    return { access_token: accessToken, expires_in: 900 };
  }

  // Update user fields
  async updateUser(userId: number, data: any) {
    await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    await this.xpService.checkAndAwardProfileCompletion(userId);
    return this.getUserById(userId);
  }

  // Sync Privy wallet to database
  async syncPrivyWallet(userId: number, walletData: any) {
    const normalizeByChain = (address?: string, blockchain?: string) => {
      const raw = (address || '').trim();
      if (!raw) return raw;
      const chain = String(blockchain || '').toUpperCase();

      // Solana base58 addresses are case-sensitive and must be stored as-is.
      if (chain === 'SOLANA') return raw;

      // EVM/Aptos-style hex addresses can be normalized to lowercase.
      return raw.toLowerCase();
    };

    const normalizedAddress = normalizeByChain(walletData.address, walletData.blockchain);
    
    this.logger.log(`Syncing wallet for user ${userId}: ${normalizedAddress} on ${walletData.blockchain}`);
    
    // Check if wallet already exists for this user, address, AND blockchain
    // We use findFirst because we don't have a unique constraint on (userId, address, blockchain) yet
    const existingWallet = await this.prisma.wallet.findFirst({
      where: {
        userId,
        address: {
          equals: normalizedAddress,
          mode: 'insensitive' // Use case-insensitive comparison
        },
        blockchain: walletData.blockchain as any,
      },
    });

    if (existingWallet) {
      this.logger.log(`Updating existing wallet: ${existingWallet.id}`);
      // Update existing wallet
      return this.prisma.wallet.update({
        where: { id: existingWallet.id },
        data: {
          privyWalletId: walletData.privyWalletId,
          type: walletData.type,
          walletClient: walletData.walletClient,
          isPrimary: walletData.isPrimary,
          address: normalizedAddress, // Ensure it's stored in normalized form
        },
      });
    } else {
      this.logger.log(`Creating NEW ${walletData.blockchain} wallet for user ${userId}`);
      // Create new wallet
      const newWallet = await this.prisma.wallet.create({
        data: {
          userId,
          privyWalletId: walletData.privyWalletId,
          address: normalizedAddress,
          blockchain: walletData.blockchain as any,
          type: walletData.type,
          walletClient: walletData.walletClient,
          isPrimary: walletData.isPrimary,
        },
      });
      this.logger.log(`✅ Wallet created with ID: ${newWallet.id}`);
      return newWallet;
    }
  }

  // Verify jwt
  async verifyToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch {
      return null;
    }
  }
}
