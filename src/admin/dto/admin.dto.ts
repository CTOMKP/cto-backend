import { ApiProperty } from '@nestjs/swagger';
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

export class ApproveMarketplaceAdDto {
  @IsString()
  adId: string;

  @IsString()
  adminUserId: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RejectMarketplaceAdDto {
  @IsString()
  adId: string;

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
  @IsEnum(['LISTING', 'AD_BOOST', 'MARKETPLACE_AD', 'ESCROW', 'WITHDRAWAL', 'OTHER'])
  @IsOptional()
  paymentType?: string;

  @IsEnum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'])
  @IsOptional()
  status?: string;
}

export class UpdateUserRoleDto {
  @IsString()
  @ApiProperty({ description: 'Target user ID', example: '123' })
  userId: string;

  @IsEnum(['USER', 'ADMIN', 'MODERATOR'])
  @ApiProperty({ description: 'Role to assign', example: 'ADMIN', enum: ['USER', 'ADMIN', 'MODERATOR'] })
  role: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the change', example: '1' })
  adminUserId: string;
}

export class AdminEscrowActionDto {
  @IsString()
  @ApiProperty({ description: 'Escrow ID', example: 'cmxabc123' })
  escrowId: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the action', example: '1' })
  adminUserId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Optional reason for the action', example: 'Policy review', required: false })
  reason?: string;
}

export class AdminEscrowExtendDto {
  @IsString()
  @ApiProperty({ description: 'Escrow ID', example: 'cmxabc123' })
  escrowId: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the action', example: '1' })
  adminUserId: string;

  @IsString()
  @ApiProperty({ description: 'New deadline in ISO format', example: '2026-06-30T23:59:59.000Z' })
  newDeadline: string;
}

export class ApproveCreatorPayoutDto {
  @IsString()
  @ApiProperty({ description: 'Creator payout ID', example: 'cmp_payout_123' })
  payoutId: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the approval', example: '1' })
  adminUserId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Optional approval note', example: 'Approved after manual review', required: false })
  note?: string;
}

export class RejectCreatorPayoutDto {
  @IsString()
  @ApiProperty({ description: 'Creator payout ID', example: 'cmp_payout_123' })
  payoutId: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the rejection', example: '1' })
  adminUserId: string;

  @IsString()
  @ApiProperty({ description: 'Reason for rejection', example: 'Wallet address mismatch' })
  reason: string;
}

export class MarkCreatorPayoutPaidDto {
  @IsString()
  @ApiProperty({ description: 'Creator payout ID', example: 'cmp_payout_123' })
  payoutId: string;

  @IsString()
  @ApiProperty({ description: 'Admin user ID performing the update', example: '1' })
  adminUserId: string;

  @IsString()
  @ApiProperty({ description: 'Payment transaction hash', example: '0xabc123...' })
  txHash: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Optional payment note', example: 'Paid via USDC transfer', required: false })
  note?: string;
}

