import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatorSignupDto {
  @IsEmail()
  @ApiProperty({ description: 'Email address for the creator account', example: 'creator@example.com' })
  email: string;

  @IsString()
  @MinLength(8)
  @ApiProperty({ description: 'Password (min 8 characters)', example: 'securePass123' })
  password: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Display name / username', example: 'John Doe', required: false })
  name?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Referral code if referred by another creator', example: 'cto-42-a1b2c3', required: false })
  referralCode?: string;
}