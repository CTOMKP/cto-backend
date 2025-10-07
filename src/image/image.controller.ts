import {
  Controller,
  Post,
  Get,
  Delete,
  Put,
  Param,
  Body,
  Res,
  HttpStatus,
  HttpException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Response } from 'express';
import { ImageService } from './image.service';
import { ImageMetadata } from './types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiBearerAuth } from '@nestjs/swagger';

class PresignUploadDto {
  @IsNotEmpty()
  @IsIn(['generic', 'profile', 'banner', 'meme'])
  type: 'generic' | 'profile' | 'banner' | 'meme';

  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  mimeType: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsNumber()
  putTtlSeconds?: number; // optional

  @IsOptional()
  @IsNumber()
  getTtlSeconds?: number; // optional

  // Note: frontend may send 'size'; whitelist it to avoid forbidNonWhitelisted errors
  @IsOptional()
  @IsNumber()
  size?: number;
}

class EditImageDto {
  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

class BulkImportDto {
  @IsNotEmpty()
  images: any[];
}

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  // Generate presigned PUT for direct-to-S3 uploads
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Post('presign')
  async presign(@Body() dto: PresignUploadDto, @Req() req: any) {
    // userId is taken from JWT, not from client, to comply with bucket policy
    const userId = req?.user?.userId?.toString();
    if (!dto?.type || !dto?.filename || !dto?.mimeType) {
      throw new HttpException('type, filename, and mimeType are required', HttpStatus.BAD_REQUEST);
    }
    return this.imageService.createPresignedUpload(dto.type, {
      userId,
      filename: dto.filename,
      mimeType: dto.mimeType,
      putTtlSeconds: dto.putTtlSeconds,
      getTtlSeconds: dto.getTtlSeconds,
    });
  }

  // Short-lived read redirect — supports keys with slashes via wildcard
  @Get('view/*')
  async viewImage(@Param('0') key: string, @Res() res: Response): Promise<void> {
    try {
      // Normalize key (replace commas with slashes for legacy support)
      const normalizedKey = key.replace(/,/g, '/');
      
      // Get a fresh short-lived presigned GET URL
      const presignedUrl = await this.imageService.getPresignedViewUrl(normalizedKey);
      
      // Redirect to S3
      res.redirect(presignedUrl);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Image not found' });
    }
  }

  /**
   * Get image metadata by ID
   * GET /images/:id
   */
  @Get(':id')
  async getImage(@Param('id') id: string): Promise<ImageMetadata> {
    return this.imageService.getImage(id);
  }

  /**
   * List all images
   * GET /images
   */
  @Get()
  async listImages(@Res() res: Response): Promise<void> {
    try {
      const images = await this.imageService.listImages();
      
      // Set compression headers
      res.set({
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30', // Cache for 30 seconds
      });
      
      res.json(images);
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
        message: 'Failed to list images',
        error: error.message 
      });
    }
  }

  /**
   * Delete image from S3
   * DELETE /images/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteImage(@Param('id') id: string): Promise<{ message: string; success: boolean }> {
    // Decode URL-encoded ID (handles slashes like memes/filename.jpg)
    const decodedId = decodeURIComponent(id);
    const success = await this.imageService.deleteImage(decodedId);
    return {
      message: success ? 'Image deleted successfully' : 'Failed to delete image',
      success,
    };
  }

  /**
   * Edit image metadata
   * PUT /images/:id
   */
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async editImage(
    @Param('id') id: string,
    @Body() editImageDto: EditImageDto
  ): Promise<ImageMetadata> {
    // Decode URL-encoded ID
    const decodedId = decodeURIComponent(id);
    return this.imageService.editImageMetadata(decodedId, editImageDto);
  }

  /**
   * Bulk import metadata for migrated images
   * POST /images/bulk-import
   */
  @UseGuards(JwtAuthGuard)
  @Post('bulk-import')
  async bulkImport(@Body() bulkImportDto: BulkImportDto): Promise<{ message: string; imported: number; skipped: number }> {
    if (!bulkImportDto.images || !Array.isArray(bulkImportDto.images)) {
      throw new HttpException('Invalid request: images array required', HttpStatus.BAD_REQUEST);
    }

    const result = await this.imageService.bulkImportMetadata(bulkImportDto.images);
    
    return {
      message: `Successfully imported ${result.imported} images (${result.skipped} skipped)`,
      imported: result.imported,
      skipped: result.skipped,
    };
  }
}

