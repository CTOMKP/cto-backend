import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength } from 'class-validator';

export class SavePfpDto {
  @ApiProperty({ 
    description: 'Profile picture URL (avatar)', 
    example: 'https://example.com/avatar.png'
  })
  @IsString()
  @IsUrl()
  @MaxLength(500)
  imageUrl: string;
}

