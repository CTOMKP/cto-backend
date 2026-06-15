import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatorPayoutRequestDto {
  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Destination payout wallet address', example: '0xabc123...', required: false })
  walletAddress?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({ description: 'Requested payout amount in USD', example: 25, required: false })
  amount?: number;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Optional payout note', example: 'First payout request', required: false })
  note?: string;
}
