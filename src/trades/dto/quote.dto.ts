import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsEnum, IsOptional, Min, Max } from 'class-validator';

export class QuoteRequestDto {
  @ApiProperty({
    description: 'Chain to execute trade on',
    enum: ['solana', 'movement', 'base'],
    example: 'solana',
  })
  @IsEnum(['solana', 'movement', 'base'])
  chain: 'solana' | 'movement' | 'base';

  @ApiProperty({
    description: 'Input token address (mint/contract address)',
    example: 'So11111111111111111111111111111111111111112',
  })
  @IsString()
  inputToken: string;

  @ApiProperty({
    description: 'Output token address (mint/contract address)',
    example: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  })
  @IsString()
  outputToken: string;

  @ApiProperty({
    description: 'Amount to swap (in native token units)',
    example: '100000000',
  })
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Swap mode',
    enum: ['ExactIn', 'ExactOut'],
    required: false,
    default: 'ExactIn',
  })
  @IsEnum(['ExactIn', 'ExactOut'])
  @IsOptional()
  swapMode?: 'ExactIn' | 'ExactOut';

  @ApiProperty({
    description: 'Slippage tolerance in basis points (1 bps = 0.01%)',
    example: 50,
    default: 50,
    minimum: 1,
    maximum: 1000,
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1000)
  slippageBps?: number;
}
