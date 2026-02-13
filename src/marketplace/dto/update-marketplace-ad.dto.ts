import { IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMarketplaceAdDto {
  @IsOptional()
  @IsEnum(['LOOKING_FOR', 'OFFERING'])
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
  category?: string;

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
}
