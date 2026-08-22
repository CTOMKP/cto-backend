import { FavoriteTargetType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFavoriteDto {
  @IsEnum(FavoriteTargetType)
  targetType: FavoriteTargetType;

  @IsString()
  @MaxLength(256)
  targetId: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  chain?: string;
}
