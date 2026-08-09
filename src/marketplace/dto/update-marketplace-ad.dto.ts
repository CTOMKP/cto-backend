import { ApiProperty } from '@nestjs/swagger';
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMarketplaceAdDto {
  @IsOptional()
  @IsIn(['LOOKING_FOR', 'OFFERING', 'looking_for', 'offering'])
  @ApiProperty({ required: false, enum: ['looking_for', 'offering'], example: 'looking_for' })
  postType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
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
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
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
  @IsEnum(['SINGULAR'])
  @ApiProperty({
    required: false,
    enum: ['SINGULAR'],
    example: 'SINGULAR',
    description: 'Marketplace ads expire 28 days after publication.',
  })
  durationMode?: string;
}
