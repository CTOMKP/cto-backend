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
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

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

@ApiTags('images')
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
  @Get('view/*key')
  async viewImage(@Param('key') key: string, @Res() res: Response): Promise<void> {
    try {
      // Accept legacy comma-separated keys like "user-uploads,4,generic,foo.jpg"
      const normalizedKey = String(key).replace(/^user-uploads[,\/]/, 'user-uploads/').replace(/,/g, '/');
      
      console.log(`[ImageController] View request for key: ${key} -> normalized: ${normalizedKey}`);
      
      // First try to get a direct public URL if the key starts with 'assets/'
      if (normalizedKey.startsWith('assets/')) {
        const publicUrl = this.imageService.getPublicAssetUrl(normalizedKey);
        return res.set({ 'Cache-Control': 'public, max-age=86400' }).redirect(publicUrl);
      }
      
      // Check if file exists in S3 before generating presigned URL
      // Access storage through imageService's private storage property
      const storage = (this.imageService as any).storage;
      if (storage && typeof storage.fileExists === 'function') {
        try {
          const exists = await storage.fileExists(normalizedKey);
          if (!exists) {
            console.error(`[ImageController] File does not exist in S3: ${normalizedKey}`);
            return res.status(HttpStatus.NOT_FOUND).json({ 
              message: 'Image not found',
              key: normalizedKey,
              error: 'File does not exist in S3 storage'
            });
          }
          console.log(`[ImageController] File exists in S3: ${normalizedKey}`);
        } catch (fileCheckError: any) {
          // If fileExists check fails (e.g., permission issue), log but continue
          console.warn(`[ImageController] Could not verify file existence: ${fileCheckError?.message || fileCheckError}`);
        }
      }
      
      // For user uploads, use a presigned URL with extended expiration
      await this.imageService.getImage(normalizedKey); // ensure metadata exists or seed fallback
      const url = await this.imageService.getPresignedViewUrl(normalizedKey, 86400); // 24 hour expiration
      console.log(`[ImageController] Generated presigned URL for: ${normalizedKey}`);
      res.set({ 'Cache-Control': 'no-store' }).redirect(url);
    } catch (error: any) {
      console.error('[ImageController] Image view error:', {
        key,
        error: error?.message || error,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
      });
      res.status(HttpStatus.NOT_FOUND).json({ 
        message: 'Image not found',
        key: key,
        error: error?.message || 'Unknown error'
      });
    }
  }

  // Download redirect with content-disposition hint
  @Get('download/*key')
  async downloadImage(@Param('key') key: string, @Res() res: Response): Promise<void> {
    try {
      // Normalize key format
      const normalizedKey = String(key).replace(/^user-uploads[,\/]/, 'user-uploads/').replace(/,/g, '/');
      
      // Use extended expiration for presigned URL
      const url = await this.imageService.getPresignedViewUrl(normalizedKey, 86400);
      res.set({
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(normalizedKey.split('/').pop() || 'download')}"`,
      }).redirect(url);
    } catch (error) {
      console.error('Image download error:', error);
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Image not found' });
    }
  }

  // List images from cache/redis (metadata only)
  @Get()
  async listImages(): Promise<ImageMetadata[]> {
    return this.imageService.listImages();
  }

  // Delete by storage key
  @UseGuards(JwtAuthGuard)
  @Delete('/*key')
  async deleteImage(@Param('key') key: string): Promise<{ success: boolean }> {
    const success = await this.imageService.deleteImage(key);
    return { success };
  }

  // Edit metadata only (does not rename underlying object)
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async editImage(
    @Param('id') id: string,
    @Body() editImageDto: EditImageDto
  ): Promise<ImageMetadata> {
    return this.imageService.editImageMetadata(id, editImageDto);
  }
}