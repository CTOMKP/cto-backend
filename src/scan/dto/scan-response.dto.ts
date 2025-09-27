import { ApiProperty } from '@nestjs/swagger';

export class ScanResultDto {
  @ApiProperty({ description: 'Token tier classification' })
  tier: string;

  @ApiProperty({ description: 'Risk score (0-100)' })
  risk_score: number;

  @ApiProperty({ description: 'Risk level description' })
  risk_level: string;

  @ApiProperty({ description: 'Whether token meets listing criteria' })
  eligible: boolean;

  @ApiProperty({ description: 'AI-generated summary' })
  summary: string;

  @ApiProperty({ description: 'Detailed token metadata' })
  metadata: {
    token_symbol: string;
    token_name: string;
    project_age_days: number;
    age_display: string;
    age_display_short: string;
    creation_date: Date;
    lp_amount_usd: number;
    token_price: number;
    volume_24h: number;
    market_cap: number;
    pool_count: number;
    lp_lock_months: number;
    lp_burned: boolean;
    lp_locked: boolean;
    lock_contract: any;
    lock_analysis: any;
    largest_lp_holder: any;
    pair_address: string;
    scan_timestamp: string;
    verified: boolean;
    holder_count: number;
    creation_transaction: string;
    distribution_metrics: any;
    whale_analysis: any;
    suspicious_activity_details: any;
    activity_summary: any;
    wallet_activity_data: any;
    smart_contract_security: any;
  };
}

export class BatchScanResponseDto {
  @ApiProperty({ description: 'Batch summary statistics' })
  batch_summary: {
    total_requested: number;
    total_scanned: number;
    successful_scans: number;
    failed_scans: number;
    eligible_tokens: number;
    ineligible_tokens: number;
    scan_timestamp: string;
  };

  @ApiProperty({ description: 'Tokens grouped by tier' })
  tokens_by_tier: Record<string, any[]>;

  @ApiProperty({ description: 'All scan results' })
  all_results: any[];

  @ApiProperty({ description: 'Statistical summary' })
  statistics: {
    tier_distribution: Record<string, number>;
    average_risk_score: number;
    total_liquidity: number;
  };
}
