import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Commitment, Connection, PublicKey } from '@solana/web3.js';

export type SolanaNetwork = 'devnet' | 'mainnet-beta';

export interface SolanaNetworkProfile {
  network: SolanaNetwork;
  chainId: 'solana:devnet' | 'solana:mainnet';
  rpcUrl: string;
  usdcMint: string;
  treasuryWallet: string;
  usdcDecimals: 6;
}

const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LEGACY_DEVNET_USDC_MINT = '6e5qtpMzrLzDM8R6fHQtoF6d2iybHBYdj56tceKZo9sn';
const LEGACY_DEVNET_TREASURY = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

@Injectable()
export class SolanaNetworkService {
  constructor(private readonly config: ConfigService) {}

  getActiveNetwork(): SolanaNetwork {
    return this.normalizeNetwork(this.config.get<string>('SOLANA_NETWORK') || 'devnet');
  }

  normalizeNetwork(value: string): SolanaNetwork {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'mainnet' || normalized === 'mainnet-beta') return 'mainnet-beta';
    if (normalized === 'devnet' || normalized === 'testnet') return 'devnet';
    throw new BadRequestException('SOLANA_NETWORK must be devnet or mainnet-beta');
  }

  getProfile(requestedNetwork?: string): SolanaNetworkProfile {
    const network = requestedNetwork ? this.normalizeNetwork(requestedNetwork) : this.getActiveNetwork();
    const activeNetwork = this.getActiveNetwork();
    const prefix = network === 'mainnet-beta' ? 'MAINNET' : 'DEVNET';
    const isActive = network === activeNetwork;
    const rpcUrl = this.config.get<string>(`SOLANA_${prefix}_RPC_URL`)?.trim()
      || (isActive ? this.config.get<string>('SOLANA_RPC_URL')?.trim() : '')
      || (network === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
    const usdcMint = this.config.get<string>(`SOLANA_${prefix}_USDC_MINT`)?.trim()
      || (isActive ? this.config.get<string>('SOLANA_USDC_MINT')?.trim() : '')
      || (network === 'mainnet-beta' ? MAINNET_USDC_MINT : LEGACY_DEVNET_USDC_MINT);
    const treasuryWallet = this.config.get<string>(`SOLANA_${prefix}_ADMIN_WALLET`)?.trim()
      || (isActive ? this.config.get<string>('SOLANA_ADMIN_WALLET')?.trim()
        || this.config.get<string>('ADMIN_WALLET_SOLANA')?.trim() : '')
      || (network === 'devnet' ? LEGACY_DEVNET_TREASURY : '');

    this.assertPublicKey(usdcMint, `${prefix} USDC mint`);
    if (!treasuryWallet) {
      throw new ServiceUnavailableException(
        `SOLANA_${prefix}_ADMIN_WALLET must be configured before accepting ${network} payments`,
      );
    }
    this.assertPublicKey(treasuryWallet, `${prefix} treasury wallet`);
    return {
      network,
      chainId: network === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet',
      rpcUrl,
      usdcMint,
      treasuryWallet,
      usdcDecimals: 6,
    };
  }

  getConnection(network?: string, commitment: Commitment = 'confirmed'): Connection {
    return new Connection(this.getProfile(network).rpcUrl, commitment);
  }

  private assertPublicKey(value: string, label: string): void {
    try {
      new PublicKey(value);
    } catch {
      throw new ServiceUnavailableException(`${label} is not a valid Solana address`);
    }
  }
}
