import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

@Injectable()
export class SolanaWalletService {
  private readonly logger = new Logger(SolanaWalletService.name);

  constructor(private readonly configService: ConfigService) {}

  private getConnection(): Connection {
    const rpcUrl =
      this.configService.get('SOLANA_RPC_URL') ||
      'https://api.mainnet-beta.solana.com';
    return new Connection(rpcUrl, 'confirmed');
  }

  private getUsdcMint(): PublicKey {
    const mint =
      this.configService.get('SOLANA_USDC_MINT') ||
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    return new PublicKey(mint);
  }

  async getWalletBalance(address: string) {
    if (!address) throw new BadRequestException('Wallet address is required');
    const connection = this.getConnection();
    const owner = new PublicKey(address);
    const usdcMint = this.getUsdcMint();

    const [solBalance, usdcAta] = await Promise.all([
      connection.getBalance(owner, 'confirmed'),
      getAssociatedTokenAddress(usdcMint, owner, false),
    ]);

    let usdcAmount = '0';
    try {
      const usdcAccount = await connection.getTokenAccountBalance(usdcAta, 'confirmed');
      usdcAmount = usdcAccount?.value?.amount || '0';
    } catch (error: any) {
      // If ATA doesn't exist, balance is zero
      this.logger.debug(`USDC ATA missing or unreadable for ${address}: ${error?.message}`);
    }

    return {
      address,
      solLamports: solBalance,
      sol: solBalance / 1e9,
      usdcAmount,
      usdc: parseFloat(usdcAmount) / 1e6,
      usdcMint: usdcMint.toBase58(),
    };
  }
}
