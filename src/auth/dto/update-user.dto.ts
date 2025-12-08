import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({ 
    description: 'User display name', 
    required: false,
    example: 'John Doe'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ 
    description: 'Profile picture URL (avatar)', 
    required: false,
    example: 'https://example.com/avatar.png'
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  @MaxLength(500)
  avatarUrl?: string;

  @ApiProperty({ 
    description: 'User bio/description', 
    required: false,
    example: 'Crypto enthusiast'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

