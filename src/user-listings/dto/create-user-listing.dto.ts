import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class CreateUserListingDto {
  @IsNotEmpty()
  @IsString()
  contractAddr!: string;

  @IsNotEmpty()
  @IsString()
  chain!: string; // keep as string for flexibility across chains

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsNotEmpty()
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoUrl must be a valid URL' })
  logoUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'bannerUrl must be a valid URL' })
  bannerUrl?: string;

  @IsOptional()
  @IsObject()
  links?: Record<string, any>; // { twitter, telegram, discord, website }

  @IsNotEmpty()
  @IsString()
  vettingTier!: string; // Seed | Sprout | Bloom | Stellar

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  vettingScore!: number;
}