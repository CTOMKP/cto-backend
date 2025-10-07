import { IsArray, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ImageMetadataDto {
  @IsNotEmpty()
  id: string;

  @IsNotEmpty()
  filename: string;

  @IsNotEmpty()
  originalName: string;

  @IsNotEmpty()
  size: number;

  @IsNotEmpty()
  mimeType: string;

  @IsNotEmpty()
  uploadDate: string | Date;

  @IsNotEmpty()
  path: string;

  @IsNotEmpty()
  url: string;

  storageProvider?: string;
  storageKey?: string;
  userId?: string;
  description?: string;
  category?: string;
}

export class BulkImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageMetadataDto)
  images: ImageMetadataDto[];
}

