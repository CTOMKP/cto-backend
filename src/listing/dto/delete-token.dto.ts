import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class DeleteTokenRequestDto {
  @ApiProperty({ description: 'Contract address of the token to delete' })
  @IsString()
  contractAddress: string;
}
