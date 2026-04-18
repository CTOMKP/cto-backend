import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'Swap failed on Solana', maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  subject: string;

  @ApiProperty({ example: 'SWAP', required: false })
  @IsString()
  @IsOptional()
  @IsIn(['GENERAL', 'SWAP', 'WALLET', 'PAYMENT', 'LISTING', 'ADS', 'ACCOUNT', 'OTHER'])
  category?: string;

  @ApiProperty({ example: 'HIGH', required: false })
  @IsString()
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @ApiProperty({
    example: 'When I swap USDC to SOL, I get an error after quote step.',
    maxLength: 4000,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message: string;
}

