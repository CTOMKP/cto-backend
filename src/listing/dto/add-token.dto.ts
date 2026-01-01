import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Chain } from '@prisma/client';

export class AddTokenRequestDto {
  @ApiProperty({ description: 'Contract address of the token to add' })
  @IsString()
  contractAddress: string;

  @ApiProperty({ description: 'Blockchain of the token', enum: Chain })
  @IsEnum(Chain)
  chain: Chain;

  @ApiProperty({ required: false, description: 'Symbol of the token' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({ required: false, description: 'Name of the token' })
  @IsOptional()
  @IsString()
  name?: string;
}
