import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

export class FaucetRequestDto {
  @ApiProperty({
    description: 'Destination Solana wallet address for test USDC faucet',
    example: '8A5vdgwdSCdk1ZVbqq2gXTEhwLTPv8MqFHvwGHMweF7z',
  })
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana wallet address format',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'Optional note for reviewers',
    required: false,
    example: 'Need test USDC to validate listing payment flow.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

