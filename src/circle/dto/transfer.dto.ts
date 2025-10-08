import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';

export enum SupportedChains {
  ETHEREUM = 'ETHEREUM',
  BASE = 'BASE',
  ARBITRUM = 'ARBITRUM',
  OPTIMISM = 'OPTIMISM',
  POLYGON = 'POLYGON',
  AVALANCHE = 'AVALANCHE',
  SOLANA = 'SOLANA',
}

export class CCTPTransferDto {
  @ApiProperty({ description: 'User ID (email)' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Source chain for the transfer' })
  @IsEnum(SupportedChains)
  sourceChain: SupportedChains;

  @ApiProperty({ description: 'Destination chain for the transfer' })
  @IsEnum(SupportedChains)
  destinationChain: SupportedChains;

  @ApiProperty({ description: 'Amount of USDC to transfer (in smallest unit)' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Destination wallet address', required: false })
  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @ApiProperty({ description: 'Wallet ID to use for the transfer', required: false })
  @IsOptional()
  @IsString()
  walletId?: string;
}

export class WormholeAttestationDto {
  @ApiProperty({ description: 'Transaction hash from source chain' })
  @IsString()
  txHash: string;

  @ApiProperty({ description: 'Source chain' })
  @IsEnum(SupportedChains)
  sourceChain: SupportedChains;

  @ApiProperty({ description: 'Destination chain' })
  @IsEnum(SupportedChains)
  destinationChain: SupportedChains;
}

export class PanoraSwapDto {
  @ApiProperty({ description: 'User ID (email)' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Source token address' })
  @IsString()
  fromToken: string;

  @ApiProperty({ description: 'Destination token address' })
  @IsString()
  toToken: string;

  @ApiProperty({ description: 'Amount to swap' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Slippage tolerance (percentage)', required: false, default: 0.5 })
  @IsOptional()
  @IsNumber()
  slippage?: number;

  @ApiProperty({ description: 'Wallet ID to use for the swap', required: false })
  @IsOptional()
  @IsString()
  walletId?: string;

  @ApiProperty({ description: 'Chain for the swap' })
  @IsEnum(SupportedChains)
  chain: SupportedChains;
}
