import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, IsOptional, Min, MaxLength } from 'class-validator';

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
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  @ApiProperty({ description: 'Deprecated and ignored; the backend calculates the ad price', example: 25, required: false })
  amountUsd?: number;
}

export class VerifySolanaPaymentDto {
  @IsString()
  @ApiProperty({ description: 'Solana payment transaction hash', example: '5J9...abc' })
  txHash: string;
}

export class BroadcastSolanaPaymentDto {
  @IsString()
  @MaxLength(10000)
  @ApiProperty({ description: 'Signed Solana transaction encoded as base64' })
  signedTransaction: string;
}

