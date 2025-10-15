import { IsString, IsNumber, IsEnum, IsOptional, Min, IsIn } from 'class-validator';

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
  paymentId: string;

  @IsString()
  userId: string;
}

export class GetPaymentHistoryDto {
  @IsString()
  userId: string;

  @IsString()
  @IsOptional()
  paymentType?: string;
}

