import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Chain } from '@prisma/client';

export class AddTokenRequestDto {
  @ApiProperty({ description: 'Contract address of the token to add' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  contractAddress: string;

  @ApiProperty({ description: 'Blockchain of the token', enum: Chain })
  @IsEnum(Chain)
  chain: Chain;

  @ApiProperty({ required: false, description: 'Symbol of the token' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @ApiProperty({ required: false, description: 'Name of the token' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;
}
