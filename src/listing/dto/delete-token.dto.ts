import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteTokenRequestDto {
  @ApiProperty({ description: 'Contract address of the token to delete' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  contractAddress: string;
}
