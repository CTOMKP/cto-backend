import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional } from 'class-validator';

export enum ChainInput {
  SOLANA = 'SOLANA',
  ETHEREUM = 'ETHEREUM',
  BSC = 'BSC',
  SUI = 'SUI',
  BASE = 'BASE',
  APTOS = 'APTOS',
  NEAR = 'NEAR',
  OSMOSIS = 'OSMOSIS',
  OTHER = 'OTHER',
  UNKNOWN = 'UNKNOWN',
}

export class AddTokenRequestDto {
  @ApiProperty({ description: 'Contract address of the token' })
  @IsString()
  contractAddress: string;

  @ApiProperty({ description: 'Blockchain chain', enum: ChainInput, default: ChainInput.SOLANA })
  @IsEnum(ChainInput)
  chain: ChainInput = ChainInput.SOLANA;

  @ApiProperty({ description: 'Token symbol (optional, will be fetched if not provided)', required: false })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({ description: 'Token name (optional, will be fetched if not provided)', required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

