import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsObject, IsOptional } from 'class-validator';

export class BuildTransactionRequestDto {
  @ApiProperty({
    description: 'Chain to execute trade on',
    enum: ['solana', 'movement', 'base', 'ethereum', 'bsc'],
    example: 'solana',
  })
  @IsEnum(['solana', 'movement', 'base', 'ethereum', 'bsc'])
  chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';

  @ApiProperty({
    description: 'Quote response from /quote endpoint',
    type: 'object',
  })
  @IsObject()
  quote: any;

  @ApiProperty({
    description: 'User wallet address',
    example: 'BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV',
  })
  @IsString()
  walletAddress: string;

  @ApiProperty({
    description: 'Slippage tolerance in basis points',
    example: 50,
    required: false,
  })
  @IsOptional()
  slippageBps?: number;
}

export class ExecuteTradeRequestDto {
  @ApiProperty({
    description: 'Chain to execute trade on',
    enum: ['solana', 'movement', 'base', 'ethereum', 'bsc'],
    example: 'solana',
  })
  @IsEnum(['solana', 'movement', 'base', 'ethereum', 'bsc'])
  chain: 'solana' | 'movement' | 'base' | 'ethereum' | 'bsc';

  @ApiProperty({
    description: 'Signed transaction from frontend',
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  signedTransaction?: any;

  @ApiProperty({
    description: 'Original quote response from /quote endpoint',
    type: 'object',
  })
  @IsObject()
  quote: any;

  @ApiProperty({
    description: 'Wallet ID (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  walletId?: string;
}
