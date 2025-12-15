import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';

/**
 * Token Image Fetching Service
 * Implements 3-tier fallback chain to ensure image URL is NEVER null
 * 
 * Tier 1: Jupiter Token List (Primary)
 * Tier 2: TrustWallet Assets (Fallback)
 * Tier 3: Deterministic Identicon (Always Available)
 */
@Injectable()
export class TokenImageService {
  private readonly logger = new Logger(TokenImageService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Fetch token image with 3-tier fallback chain
   * @param contractAddress - Token contract address
   * @param chain - Blockchain chain (default: 'solana')
   * @returns Image URL (guaranteed non-null)
   */
  async fetchTokenImage(contractAddress: string, chain: string = 'solana'): Promise<string> {
    if (chain.toLowerCase() !== 'solana') {
      // For non-Solana chains, use Identicon directly
      return this.generateIdenticon(contractAddress);
    }

    // Tier 1: Jupiter Token List (Primary)
    const jupiterImage = await this.fetchFromJupiter(contractAddress);
    if (jupiterImage) {
      this.logger.debug(`Found image for ${contractAddress} from Jupiter`);
      return jupiterImage;
    }

    // Tier 2: TrustWallet Assets (Fallback)
    const trustWalletImage = await this.checkTrustWallet(contractAddress);
    if (trustWalletImage) {
      this.logger.debug(`Found image for ${contractAddress} from TrustWallet`);
      return trustWalletImage;
    }

    // Tier 3: Deterministic Identicon (Always Available)
    this.logger.debug(`Using Identicon fallback for ${contractAddress}`);
    return this.generateIdenticon(contractAddress);
  }

  /**
   * Tier 1: Fetch from Jupiter Token List
   */
  private async fetchFromJupiter(contractAddress: string): Promise<string | null> {
    try {
      // Try verified tokens first
      const verifiedUrl = 'https://tokens.jup.ag/tokens?tags=verified';
      const verifiedResponse = await firstValueFrom(
        this.httpService.get(verifiedUrl, { timeout: 10000 })
      );

      if (Array.isArray(verifiedResponse.data)) {
        const token = verifiedResponse.data.find(
          (t: any) => (t.address === contractAddress) || (t.mint === contractAddress)
        );
        if (token?.logoURI) {
          return token.logoURI;
        }
      }

      // If not in verified list, try full list
      const fullUrl = 'https://tokens.jup.ag/tokens';
      const fullResponse = await firstValueFrom(
        this.httpService.get(fullUrl, { timeout: 10000 })
      );

      if (Array.isArray(fullResponse.data)) {
        const token = fullResponse.data.find(
          (t: any) => (t.address === contractAddress) || (t.mint === contractAddress)
        );
        if (token?.logoURI) {
          return token.logoURI;
        }
      }
    } catch (error) {
      this.logger.debug(`Jupiter image fetch failed for ${contractAddress}: ${error.message}`);
    }

    return null;
  }

  /**
   * Tier 2: Check TrustWallet Assets
   */
  private async checkTrustWallet(contractAddress: string): Promise<string | null> {
    try {
      const trustWalletUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${contractAddress}/logo.png`;
      
      // Use HEAD request to check if image exists
      const response = await axios.head(trustWalletUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 500, // Don't throw on 404
      });

      if (response.status === 200) {
        return trustWalletUrl;
      }
    } catch (error) {
      this.logger.debug(`TrustWallet image check failed for ${contractAddress}: ${error.message}`);
    }

    return null;
  }

  /**
   * Tier 3: Generate Deterministic Identicon
   * Always returns a valid image URL
   */
  private generateIdenticon(contractAddress: string): string {
    const seed = encodeURIComponent(contractAddress);
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;
  }
}
