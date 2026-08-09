import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum ChainInput {
  SOLANA = 'SOLANA',
  EVM = 'EVM',
  NEAR = 'NEAR',
  OSMOSIS = 'OSMOSIS',
  OTHER = 'OTHER',
}

export class ListingScanRequestDto {
  @ApiProperty({ description: 'Contract address to scan' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  contractAddress: string;

  @ApiProperty({ description: 'Chain of the contract', enum: ChainInput })
  @IsEnum(ChainInput)
  chain: ChainInput = ChainInput.SOLANA;
}
