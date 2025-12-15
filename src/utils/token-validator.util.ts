/**
 * Token Validator Utility
 * Handles validation and filtering of Solana tokens (native vs SPL)
 */

export class TokenValidatorUtil {
  /**
   * Known native/wrapped token addresses that should be filtered out
   * These are not true SPL tokens and don't work with most APIs
   */
  private static readonly NATIVE_TOKEN_ADDRESSES = new Set([
    'So11111111111111111111111111111111111111112', // Wrapped SOL (native)
    // Note: USDC and USDT on Solana are actually SPL tokens, not native
    // So we keep them in the system
  ]);

  /**
   * Valid SPL token addresses that should be included
   * These are well-known tokens that work with all APIs
   */
  private static readonly VALID_SPL_TOKENS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC (SPL)
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT (SPL)
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
    '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH (Wormhole)
    'A94X1fR3W6LrFxXxPp22SbyMpUfWHAfckD8vro5tRhtb', // RAY
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // COPE
    '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', // FIDA
    'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
    'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  ]);

  /**
   * Check if an address is a native token that should be filtered out
   */
  static isNativeToken(address: string): boolean {
    const normalized = address.trim();
    return this.NATIVE_TOKEN_ADDRESSES.has(normalized);
  }

  /**
   * Check if an address is a known valid SPL token
   */
  static isValidSPLToken(address: string): boolean {
    const normalized = address.trim();
    return this.VALID_SPL_TOKENS.has(normalized);
  }

  /**
   * Validate if a token address should be processed
   * Returns true if it's a valid SPL token (not a native token)
   */
  static shouldProcessToken(address: string, chain: string): {
    valid: boolean;
    reason?: string;
  } {
    if (chain.toLowerCase() !== 'solana') {
      // For non-Solana chains, use basic validation
      return { valid: true };
    }

    const normalized = address.trim();

    // Filter out native tokens
    if (this.isNativeToken(normalized)) {
      return {
        valid: false,
        reason: 'Native token (not an SPL token). Use SPL tokens only.',
      };
    }

    // If it's a known valid SPL token, allow it
    if (this.isValidSPLToken(normalized)) {
      return { valid: true };
    }

    // For unknown addresses, check format (must be valid Solana base58)
    const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!solanaRegex.test(normalized)) {
      return {
        valid: false,
        reason: 'Invalid Solana address format',
      };
    }

    // Unknown addresses that match format - allow them (they might be new SPL tokens)
    return { valid: true };
  }

  /**
   * Filter an array of token addresses to only include valid SPL tokens
   */
  static filterValidSPLTokens(addresses: string[], chain: string): string[] {
    return addresses.filter((address) => {
      const validation = this.shouldProcessToken(address, chain);
      if (!validation.valid) {
        // Log why it was filtered (optional, for debugging)
        // console.log(`Filtered ${address}: ${validation.reason}`);
      }
      return validation.valid;
    });
  }
}

