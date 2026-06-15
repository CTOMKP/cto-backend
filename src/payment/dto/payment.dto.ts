import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';

export class CreateListingPaymentDto {
  @IsString()
  userId: string;

  @IsString()
  listingId: string;

  @IsString()
  @IsOptional()
  walletId?: string;
}

export class CreateAdBoostPaymentDto {
  @IsString()
  userId: string;

  @IsString()
  listingId: string; // UserListing ID to boost

  @IsEnum(['top', 'priority', 'bump', 'spotlight', 'homepage', 'urgent'])
  boostType: string;

  @IsNumber()
  @Min(1)
  durationDays: number;

  @IsString()
  @IsOptional()
  walletId?: string;
}

export class VerifyPaymentDto {
  @IsString()
  @ApiProperty({ description: 'Payment ID to verify', example: 'cmx_payment_123' })
  paymentId: string;

  @IsString()
  @ApiProperty({ description: 'Authenticated user ID', example: '1' })
  userId: string;
}

export class GetPaymentHistoryDto {
  @IsString()
  @ApiProperty({ description: 'Authenticated user ID', example: '1' })
  userId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Optional payment type filter', example: 'LISTING', required: false })
  paymentType?: string;
}

export class CreateSolanaMarketplaceAdPaymentDto {
  @IsNumber()
  @Min(0.000001)
  @ApiProperty({ description: 'Marketplace ad amount in USD', example: 25 })
  amountUsd: number;
}

export class VerifySolanaPaymentDto {
  @IsString()
  @ApiProperty({ description: 'Solana payment transaction hash', example: '5J9...abc' })
  txHash: string;
}

