import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import * as crypto from 'crypto';

@Injectable()
export class AptosWalletService {
  private readonly logger = new Logger(AptosWalletService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';

  constructor(private prisma: PrismaService) {
    // Use environment variable for encryption key
    const encryptionKey = process.env.APTOS_WALLET_ENCRYPTION_KEY || 'default-key-please-change-in-production-32bytes';
    this.ENCRYPTION_KEY = crypto.scryptSync(encryptionKey, 'salt', 32);
  }

  /**
   * Encrypts a private key for secure storage
   */
  private encryptPrivateKey(privateKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts a private key for transaction signing
   */
  private decryptPrivateKey(encryptedData: string): string {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Creates a new Aptos wallet for a user
   */
  async createAptosWallet(userId: number): Promise<{ address: string; wallet: any }> {
    try {
      this.logger.log(`Creating Aptos wallet for user ID: ${userId}`);

      // Check if user already has an Aptos wallet
      const existingWallet = await this.prisma.wallet.findFirst({
        where: {
          userId,
          address: { startsWith: '0x' },
          walletClient: 'APTOS_EMBEDDED',
        },
      });

      if (existingWallet) {
        this.logger.log(`User ${userId} already has an Aptos wallet: ${existingWallet.address}`);
        return {
          address: existingWallet.address,
          wallet: existingWallet,
        };
      }

      // Generate a new Aptos account
      const account = Account.generate();
      const aptosAddress = account.accountAddress.toString();
      const privateKey = account.privateKey.toString();

      this.logger.log(`Generated Aptos address: ${aptosAddress}`);

      // Encrypt the private key before storing
      const encryptedPrivateKey = this.encryptPrivateKey(privateKey);

      // Save to database
      const wallet = await this.prisma.wallet.create({
        data: {
          userId,
          address: aptosAddress,
          blockchain: 'APTOS',
          walletClient: 'APTOS_EMBEDDED',
          type: 'APTOS_GENERATED',
          isPrimary: false,
          privyWalletId: null,
          encryptedPrivateKey: encryptedPrivateKey,
        },
      });

      this.logger.log(`Aptos wallet saved to database for user ${userId}`);

      return {
        address: aptosAddress,
        wallet,
      };
    } catch (error) {
      this.logger.error(`Failed to create Aptos wallet: ${error.message}`, error.stack);
      throw new Error(`Failed to create Aptos wallet: ${error.message}`);
    }
  }

  /**
   * Gets the Aptos account for signing transactions
   */
  async getAptosAccount(userId: number): Promise<Account | null> {
    try {
      const wallet = await this.prisma.wallet.findFirst({
        where: {
          userId,
          walletClient: 'APTOS_EMBEDDED',
        },
      });

      if (!wallet || !wallet.encryptedPrivateKey) {
        return null;
      }

      // Decrypt the private key
      const privateKeyHex = this.decryptPrivateKey(wallet.encryptedPrivateKey);
      
      // Recreate the account from the private key
      const privateKey = new Ed25519PrivateKey(privateKeyHex);
      const account = Account.fromPrivateKey({ privateKey });

      return account;
    } catch (error) {
      this.logger.error(`Failed to get Aptos account: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Gets all wallets for a user (Privy + Aptos)
   */
  async getUserWallets(userId: number): Promise<any[]> {
    return this.prisma.wallet.findMany({
      where: { userId },
      select: {
        id: true,
        address: true,
        walletClient: true,
        type: true,
        blockchain: true,
        isPrimary: true,
        createdAt: true,
      },
    });
  }
}

