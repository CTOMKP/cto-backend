import { IsString, IsEnum, IsOptional } from 'class-validator';

export class ApproveListingDto {
  @IsString()
  listingId: string;

  @IsString()
  adminUserId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectListingDto {
  @IsString()
  listingId: string;

  @IsString()
  adminUserId: string;

  @IsString()
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class GetPendingListingsDto {
  @IsString()
  @IsOptional()
  status?: string;
}

export class GetPaymentsDto {
  @IsEnum(['LISTING', 'AD_BOOST', 'ESCROW', 'WITHDRAWAL', 'OTHER'])
  @IsOptional()
  paymentType?: string;

  @IsEnum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'])
  @IsOptional()
  status?: string;
}

export class UpdateUserRoleDto {
  @IsString()
  userId: string;

  @IsEnum(['USER', 'ADMIN', 'MODERATOR'])
  role: string;

  @IsString()
  adminUserId: string;
}

