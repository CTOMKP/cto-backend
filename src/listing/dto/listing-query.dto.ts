import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ChainDto {
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

export enum ListingCategoryDto {
  MEME = 'MEME',
  DEFI = 'DEFI',
  NFT = 'NFT',
  OTHER = 'OTHER',
  UNKNOWN = 'UNKNOWN',
}

export class ListingQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({ required: false, enum: ChainDto })
  @IsOptional()
  @IsEnum(ChainDto)
  chain?: ChainDto;

  @ApiProperty({ required: false, enum: ListingCategoryDto })
  @IsOptional()
  @IsEnum(ListingCategoryDto)
  category?: ListingCategoryDto;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tier?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minRisk?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxRisk?: number;

  @ApiProperty({ required: false, default: 'updatedAt:desc' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;
}