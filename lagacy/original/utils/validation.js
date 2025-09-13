/**
 * Validates if a string is a valid Solana address format
 * Solana addresses are base58 encoded and 44 characters long
 */
export function validateSolanaAddress(address) {
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
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  return input.trim().replace(/[<>\"']/g, '');
}
