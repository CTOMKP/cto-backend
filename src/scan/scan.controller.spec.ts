import { ScanController } from './scan.controller';
import { Pillar1RiskScoringService } from '../services/pillar1-risk-scoring.service';
import { SolanaApiService } from './services/solana-api.service';

describe('ScanController cache versioning', () => {
  const contractAddress = 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey';

  it('bypasses a cached scan that predates the current market-data aggregation', async () => {
    const freshResult = {
      tier: null,
      risk_score: 20,
      risk_level: 'HIGH',
      eligible: false,
      summary: 'Fresh result',
      metadata: {
        volume_24h: 8_786.93,
        market_data: { version: SolanaApiService.MARKET_DATA_VERSION },
      },
    };
    const scanService = {
      scanToken: jest.fn().mockResolvedValue(freshResult),
    };
    const prisma = {
      scanResult: {
        findFirst: jest.fn().mockResolvedValue({
          scoringVersion: Pillar1RiskScoringService.SCORING_VERSION,
          riskScore: 20,
          tier: null,
          resultData: {
            risk_score: 20,
            eligible: false,
            summary: 'Stale result',
            metadata: { volume_24h: 0.13, market_data: {} },
          },
        }),
      },
    };
    const controller = new ScanController(scanService as any, prisma as any);

    const result = await controller.scanSingleToken(
      { contractAddress, chain: 'SOLANA' } as any,
      { user: { userId: 7 } },
    );

    expect(scanService.scanToken).toHaveBeenCalledWith(contractAddress, 7, 'SOLANA');
    expect(result).toBe(freshResult);
  });
});
