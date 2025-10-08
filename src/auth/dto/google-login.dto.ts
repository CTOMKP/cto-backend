import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Google account subject/id from OAuth', example: '113284923742349872349' })
  @IsString()
  @IsNotEmpty()
  providerId!: string;
}