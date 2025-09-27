import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanDto {
  @IsNotEmpty()
  @IsString()
  contractAddr!: string;

  @IsOptional()
  @IsString()
  chain?: string; // e.g., SOLANA | APTOS | BSC | etc.
}