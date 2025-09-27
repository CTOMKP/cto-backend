import { IsString, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScanRequestDto {
  @ApiProperty({
    description: 'Solana contract address to scan',
    example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  })
  @IsString()
  contractAddress: string;
}

export class BatchScanRequestDto {
  @ApiProperty({
    description: 'Array of Solana contract addresses to scan',
    example: ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'AnotherContractAddress...'],
    isArray: true
  })
  @IsArray()
  @IsString({ each: true })
  contractAddresses: string[];
}
