import { Pillar1RiskScoringService, TokenVettingData } from './pillar1-risk-scoring.service';

describe('Pillar1RiskScoringService', () => {
  const service = new Pillar1RiskScoringService();

  const buildToken = (overrides: Partial<TokenVettingData> = {}): TokenVettingData => ({
    contractAddress: '11111111111111111111111111111111',
    chain: 'solana',
    tokenInfo: { name: 'Fixture', symbol: 'FIX', image: 'https://example.test/fix.png', decimals: 6 },
    security: {
      isMintable: false,
      isFreezable: false,
      lpLockPercentage: 100,
      totalSupply: 1_000_000,
      circulatingSupply: 1_000_000,
      lpLocks: [{ tag: 'Locked', months: 48 }],
    },
    holders: {
      count: 2_000,
      topHolders: [
        { address: 'holder-1', balance: 40_000, percentage: 4 },
        { address: 'holder-2', balance: 30_000, percentage: 3 },
      ],
    },
    developer: {
      creatorAddress: 'creator',
      creatorBalance: 0,
      creatorStatus: 'creator_sold',
      top10HolderRate: 0.07,
      twitterCreateTokenCount: 0,
    },
    trading: {
      price: 1,
      priceChange24h: 1,
      volume24h: 50_000,
      buys24h: 100,
      sells24h: 80,
      liquidity: 150_000,
      fdv: 1_000_000,
      holderCount: 2_000,
    },
    tokenAge: 90,
    evidence: {
      authorities: 'observed',
      holderDistribution: 'observed',
      holderCount: 'observed',
      liquidity: 'observed',
      lpLock: 'observed',
      creator: 'observed',
      tokenAge: 'observed',
    },
    ...overrides,
  });

  it('keeps the public score direction higher-is-safer and versions the policy', () => {
    const result = service.calculateRiskScore(buildToken());

    expect(result.scoreDirection).toBe('HIGHER_IS_SAFER');
    expect(result.scoringVersion).toBe('pillar1-solana-v4');
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.riskLevel).toBe('low');
    expect(result.eligibleTier).toBe('stellar');
  });

  it('does not interpret unavailable authority data as renounced authorities', () => {
    const token = buildToken({
      security: { ...buildToken().security, isMintable: null, isFreezable: null },
      evidence: { ...buildToken().evidence, authorities: 'unknown' },
    });
    const result = service.calculateRiskScore(token);

    expect(result.dataSufficient).toBe(false);
    expect(result.missingData).toContain('Mint/freeze authority');
    expect(result.eligibleTier).toBe('none');
    expect(result.componentScores.technical.score).toBe(0);
    expect(result.componentScores.technical.flags.join(' ')).toContain('UNVERIFIED');
  });

  it('does not assign a tier without independently observed LP lock evidence', () => {
    const token = buildToken({
      evidence: { ...buildToken().evidence, lpLock: 'unknown' },
    });
    const result = service.calculateRiskScore(token);

    expect(result.eligibleTier).toBe('none');
    expect(result.missingData).toContain('LP lock verification');
  });

  it('applies conservative component penalties when free providers miss evidence', () => {
    const token = buildToken({
      security: { ...buildToken().security, lpLockPercentage: 0, lpLocks: [] },
      holders: { count: null, topHolders: [] },
      developer: {
        ...buildToken().developer,
        creatorAddress: null,
        creatorBalance: null,
        creatorStatus: 'unknown',
      },
      trading: { ...buildToken().trading, liquidity: 3_900 },
      tokenAge: null,
      evidence: {
        ...buildToken().evidence,
        holderDistribution: 'unknown',
        holderCount: 'unknown',
        lpLock: 'unknown',
        creator: 'unknown',
        tokenAge: 'unknown',
      },
    });

    const result = service.calculateRiskScore(token);

    expect(result.overallScore).toBe(20);
    expect(result.verificationCoverage).toBe(33);
    expect(result.riskLevel).toBe('high');
    expect(result.dataSufficient).toBe(false);
    expect(result.eligibleTier).toBe('none');
    expect(result.missingData).toEqual([
      'Token age',
      'LP lock verification',
      'Holder distribution',
      'Creator wallet',
    ]);
  });

  it('distinguishes a verified unlocked pool from missing LP evidence', () => {
    const token = buildToken({
      security: { ...buildToken().security, lpLockPercentage: 0, lpLocks: [] },
    });

    const result = service.calculateRiskScore(token);

    expect(result.dataSufficient).toBe(true);
    expect(result.componentScores.liquidity.score).toBe(40);
    expect(result.eligibleTier).toBe('none');
    expect(result.unmetRequirements).toContain(
      'LP must be locked for at least 6 months or burned',
    );
  });

  it('accepts lock durations above the old narrow maximum ranges', () => {
    const result = service.calculateRiskScore(buildToken());
    expect(result.eligibleTier).toBe('stellar');
  });
});
