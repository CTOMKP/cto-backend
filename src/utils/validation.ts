/**
 * Validates if a string is a valid Solana address format
 * Solana addresses are base58 encoded and 44 characters long
 */
export function validateSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Check length (Solana addresses are typically 32-44 characters)
  if (address.length < 32 || address.length > 44) {
    return false;
  }

  // Check if it contains only valid base58 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  if (!base58Regex.test(address)) {
    return false;
  }

  // Additional checks can be added here for more thorough validation
  return true;
}

/**
 * Normalize an Aptos-style hex address to a canonical 0x + 64 hex format.
 */
export function normalizeAptosHexAddress(address: string): string | null {
  if (!address || typeof address !== 'string') {
    return null;
  }

  const raw = address.trim();
  const match = raw.match(/^0x([a-fA-F0-9]{1,64})$/);
  if (!match) {
    return null;
  }

  return `0x${match[1].toLowerCase().padStart(64, '0')}`;
}

/**
 * Aptos coin types can be either:
 * - 0x...::module::CoinName
 * - plain metadata / asset addresses (0x...)
 */
export function validateAptosAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  const trimmed = address.trim();
  if (normalizeAptosHexAddress(trimmed)) {
    return true;
  }

  const coinTypeMatch = trimmed.match(
    /^0x([a-fA-F0-9]{1,64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/,
  );

  return !!coinTypeMatch;
}

export function isAptosCoinType(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  return /^0x([a-fA-F0-9]{1,64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/.test(
    address.trim(),
  );
}

export function normalizeAptosCoinType(address: string): string | null {
  if (!isAptosCoinType(address)) {
    return null;
  }

  const trimmed = address.trim();
  const [account, module, structName] = trimmed.split('::');
  const normalizedAccount = normalizeAptosHexAddress(account);
  if (!normalizedAccount) {
    return null;
  }

  return `${normalizedAccount}::${module}::${structName}`;
}

/**
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeInput(input: any): any {
  if (typeof input !== 'string') {
    return input;
  }
  
  return input.trim().replace(/[<>\"']/g, '');
}

