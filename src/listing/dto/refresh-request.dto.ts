import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ChainRefreshInput {
  SOLANA = 'SOLANA',
  EVM = 'EVM',
  NEAR = 'NEAR',
  OSMOSIS = 'OSMOSIS',
  OTHER = 'OTHER',
  UNKNOWN = 'UNKNOWN',
}

export class RefreshRequestDto {
  @ApiProperty({ description: 'Contract address to refresh' })
  @IsString()
  contractAddress: string;

  @ApiProperty({ description: 'Chain for the contract', enum: ChainRefreshInput, required: false })
  @IsOptional()
  @IsEnum(ChainRefreshInput)
  chain?: ChainRefreshInput;
}