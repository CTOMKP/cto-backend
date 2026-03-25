import {
  isAptosCoinType,
  normalizeAptosCoinType,
  normalizeAptosHexAddress,
  validateAptosAddress,
  validateSolanaAddress,
} from './validation';

describe('validation utils', () => {
  it('validates standard solana addresses', () => {
    expect(validateSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
    expect(validateSolanaAddress('bad-address')).toBe(false);
  });

  it('validates and normalizes aptos coin types', () => {
    const coinType =
      '0xae1a55d6d42ec911229cd901bce25ddde33ddb5cda806ad7c37437f69458a8f9::coin_factory::Emojicoin';

    expect(validateAptosAddress(coinType)).toBe(true);
    expect(isAptosCoinType(coinType)).toBe(true);
    expect(normalizeAptosCoinType(coinType)).toBe(
      '0xae1a55d6d42ec911229cd901bce25ddde33ddb5cda806ad7c37437f69458a8f9::coin_factory::Emojicoin',
    );
  });

  it('validates and normalizes aptos metadata addresses', () => {
    expect(validateAptosAddress('0x1')).toBe(true);
    expect(normalizeAptosHexAddress('0x1')).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    );
  });
});
