import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateAdBoostDto {
  @IsNotEmpty()
  @IsString()
  type!: string; // top | priority | bump | spotlight | homepage | urgent

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsDateString()
  startDate?: string; // ISO
}