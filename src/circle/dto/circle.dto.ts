import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CircleCreateUserDto {
  @ApiProperty()
  @IsString()
  userId: string; // email as userId

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  password: string;
}

export class CircleLoginDto {
  @ApiProperty()
  @IsString()
  userId: string; // email

  @ApiProperty()
  @IsString()
  password: string;
}

export class CircleUserTokenDto {
  @ApiProperty()
  @IsString()
  userId: string;
}

export class InitializeUserDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userToken?: string;

  @ApiProperty({ required: false, default: 'APTOS' })
  @IsOptional()
  @IsString()
  blockchain?: string;
}

export class CreateWalletDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty({ required: false, default: 'APTOS' })
  @IsOptional()
  @IsString()
  blockchain?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsString()
  userId: string; // email

  @ApiProperty()
  @IsString()
  newPassword: string;
}