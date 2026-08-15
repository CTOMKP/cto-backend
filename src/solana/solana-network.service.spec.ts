import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SolanaNetworkService } from './solana-network.service';

const TREASURY = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

describe('SolanaNetworkService', () => {
  it('defaults safely to devnet', () => {
    const service = new SolanaNetworkService(new ConfigService({}));
    const profile = service.getProfile();
    expect(profile.network).toBe('devnet');
    expect(profile.chainId).toBe('solana:devnet');
    expect(profile.rpcUrl).toContain('devnet');
  });

  it('selects the complete mainnet profile with one switch', () => {
    const service = new SolanaNetworkService(
      new ConfigService({
        SOLANA_NETWORK: 'mainnet-beta',
        SOLANA_MAINNET_RPC_URL: 'https://mainnet.example.invalid',
        SOLANA_MAINNET_ADMIN_WALLET: TREASURY,
      }),
    );
    const profile = service.getProfile();
    expect(profile.network).toBe('mainnet-beta');
    expect(profile.chainId).toBe('solana:mainnet');
    expect(profile.rpcUrl).toBe('https://mainnet.example.invalid');
    expect(profile.usdcMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(profile.treasuryWallet).toBe(TREASURY);
  });

  it('normalizes the operational testnet alias to devnet', () => {
    const service = new SolanaNetworkService(
      new ConfigService({ SOLANA_NETWORK: 'testnet' }),
    );
    expect(service.getActiveNetwork()).toBe('devnet');
  });

  it('rejects an unknown network instead of silently accepting payments', () => {
    const service = new SolanaNetworkService(
      new ConfigService({ SOLANA_NETWORK: 'production-ish' }),
    );
    expect(() => service.getActiveNetwork()).toThrow(BadRequestException);
  });
});
