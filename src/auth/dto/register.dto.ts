import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'User name', example: 'Alice Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'User email', example: 'user@example.com', format: 'email' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Password (min 6 chars)', example: 'secret123' })
  @IsString()
  @MinLength(6)
  password: string;
}