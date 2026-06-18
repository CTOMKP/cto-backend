import { ApiProperty } from '@nestjs/swagger';
import { Allow, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMarketplaceAdDto {
  @IsOptional()
  @IsEnum(['LOOKING_FOR', 'OFFERING'])
  @ApiProperty({ required: false, enum: ['LOOKING_FOR', 'OFFERING'], example: 'LOOKING_FOR' })
  postType?: string;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @MaxLength(2000)
  description: string;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  subCategory?: string;

  @IsOptional()
  @IsString()
  contactInfo?: string;

  @IsOptional()
  @IsEnum(['SOLANA', 'ETHEREUM', 'BSC', 'SUI', 'BASE', 'APTOS', 'MOVEMENT', 'NEAR', 'OSMOSIS', 'OTHER', 'UNKNOWN'])
  chain?: string;

  @IsOptional()
  @IsString()
  offerType?: string;

  @IsOptional()
  @IsNumber()
  priceAmount?: number;

  @IsOptional()
  @IsString()
  priceCurrency?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  // Accepted for frontend compatibility. Ad expiry is still driven by publish flow.
  @IsOptional()
  @IsString()
  deadline?: string;

  // Accepted for frontend compatibility; uploader identity is derived from JWT on backend.
  @IsOptional()
  @Allow()
  user?: unknown;

  @IsOptional()
  @IsEnum(['FREE', 'PLUS', 'PREMIUM'])
  tier?: string;

  @IsOptional()
  @IsBoolean()
  featuredPlacement?: boolean;

  @IsOptional()
  @IsBoolean()
  homepageSpotlight?: boolean;

  @IsOptional()
  @IsNumber()
  @IsIn([1, 3, 7])
  topOfDayDays?: number;

  @IsOptional()
  @IsNumber()
  @IsIn([1, 3, 7])
  autoBumpDays?: number;

  @IsOptional()
  @IsBoolean()
  urgentTag?: boolean;

  @IsOptional()
  @IsBoolean()
  multiChainTag?: boolean;

  @IsOptional()
  @IsEnum(['SINGULAR', 'RECURRING'])
  @ApiProperty({
    required: false,
    enum: ['SINGULAR', 'RECURRING'],
    example: 'SINGULAR',
    description: 'Singular ads expire after 28 days; recurring ads remain open after successful payment until the user closes them.',
  })
  durationMode?: string;
}
