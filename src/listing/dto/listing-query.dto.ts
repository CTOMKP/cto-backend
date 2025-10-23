import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
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

  // New filter fields
  @ApiProperty({ required: false, description: 'Filter by LP burned percentage (e.g., 50 for >=50%)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minLpBurned?: number;

  @ApiProperty({ required: false, description: 'Filter by top 10 holders percentage (e.g., 15 for <15%)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxTop10Holders?: number;

  @ApiProperty({ required: false, description: 'Filter by mint authority disabled' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mintAuthDisabled?: boolean;

  @ApiProperty({ required: false, description: 'Filter by raiding detection (false = no raiding)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  noRaiding?: boolean;

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