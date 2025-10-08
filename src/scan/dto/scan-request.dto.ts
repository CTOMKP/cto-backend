import { IsString, IsArray, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ScanChainInput {
  SOLANA = 'SOLANA',
  EVM = 'EVM',
  NEAR = 'NEAR',
  OSMOSIS = 'OSMOSIS',
  OTHER = 'OTHER',
}

export class ScanRequestDto {
  @ApiProperty({
    description: 'Contract address to scan',
    example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  })
  @IsString()
  contractAddress: string;

  @ApiProperty({ description: 'Chain of the contract', enum: ScanChainInput, required: false, default: ScanChainInput.SOLANA })
  @IsOptional()
  @IsEnum(ScanChainInput)
  chain?: ScanChainInput;
}

export class BatchScanRequestDto {
  @ApiProperty({
    description: 'Array of contract addresses to scan',
    example: ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'AnotherContractAddress...'],
    isArray: true
  })
  @IsArray()
  @IsString({ each: true })
  contractAddresses: string[];
}
