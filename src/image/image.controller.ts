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

  // Simple test route to verify routing works
  @Get('ping')
  ping() {
    return { message: 'Image controller is working', timestamp: new Date().toISOString() };
  }

  // Short-lived read redirect — supports keys with slashes via wildcard
  // Using catch-all pattern that works with Express routing
  @Get('view/**')
  async viewImage(@Req() req: any, @Res() res: Response): Promise<void> {
    // Extract the key from the request path (outside try block for error handling)
    const fullPath = req.url; // e.g., /api/v1/images/view/user-uploads/70/profile/file.png
    const viewPrefix = '/api/v1/images/view/';
    let key = fullPath.startsWith(viewPrefix) 
      ? fullPath.substring(viewPrefix.length) 
      : fullPath.replace(/^\/api\/v1\/images\/view\//, '');
    
    // Decode URL encoding
    try {
      key = decodeURIComponent(key);
    } catch {
      // If decode fails, use as-is
    }
    
    try {
      // Accept legacy comma-separated keys like "user-uploads,4,generic,foo.jpg"
      const normalizedKey = String(key).replace(/^user-uploads[,\/]/, 'user-uploads/').replace(/,/g, '/');
      
      console.log(`[ImageController] View request for key: ${key} -> normalized: ${normalizedKey}`);
      
      // First try to get a direct public URL if the key starts with 'assets/'
      if (normalizedKey.startsWith('assets/')) {
        const publicUrl = this.imageService.getPublicAssetUrl(normalizedKey);
        return res.set({ 'Cache-Control': 'public, max-age=86400' }).redirect(publicUrl);
      }
      
      // Check if file exists in S3 (non-blocking - we'll still try to generate presigned URL)
      // This is just for logging/debugging purposes
      try {
        const exists = await this.imageService.fileExists(normalizedKey);
        if (exists) {
          console.log(`[ImageController] ✅ File exists in S3: ${normalizedKey}`);
        } else {
          console.warn(`[ImageController] ⚠️ File not found in S3: ${normalizedKey} - but will still try to generate presigned URL (may be propagating)`);
        }
      } catch (fileCheckError: any) {
        // If fileExists check fails (e.g., permission issue), log but continue
        // Don't block the request - the presigned URL might still work
        console.warn(`[ImageController] Could not verify file existence: ${fileCheckError?.message || fileCheckError} - continuing anyway`);
      }
      
      // For user uploads, use a presigned URL with extended expiration
      console.log(`[ImageController] Getting image metadata for: ${normalizedKey}`);
      try {
        await this.imageService.getImage(normalizedKey); // ensure metadata exists or seed fallback
        console.log(`[ImageController] Image metadata retrieved successfully`);
      } catch (getImageError: any) {
        console.warn(`[ImageController] getImage failed (non-critical): ${getImageError?.message || getImageError}`);
        // Continue anyway - we can still generate presigned URL
      }
      
      // Generate presigned URL and redirect - simpler and avoids QUIC issues
      // S3 CORS is already configured, so this should work
      console.log(`[ImageController] Generating presigned view URL for: ${normalizedKey}`);
      const presignedUrl = await this.imageService.getPresignedViewUrl(normalizedKey, 86400); // 24 hour expiration
      console.log(`[ImageController] ✅ Generated presigned URL successfully`);
      
      // Redirect to S3 presigned URL - browser will handle CORS with S3's configured headers
      res.set({ 'Cache-Control': 'public, max-age=86400' }).redirect(302, presignedUrl);
    } catch (error: any) {
      const normalizedKey = String(key).replace(/^user-uploads[,\/]/, 'user-uploads/').replace(/,/g, '/');
      console.error('[ImageController] ❌ Image view error - FULL DETAILS:', {
        key,
        normalizedKey,
        errorMessage: error?.message || error,
        errorName: error?.name,
        errorCode: error?.code,
        errorStack: error?.stack,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });
      res.status(HttpStatus.NOT_FOUND).json({ 
        message: 'Image not found',
        key: key,
        normalizedKey: normalizedKey,
        error: error?.message || 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? {
          name: error?.name,
          code: error?.code,
          stack: error?.stack,
        } : undefined,
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

  // Diagnostic endpoint to test S3 access and presigned URL generation
  @Get('test/*key')
  async testImageAccess(@Param('key') key: string): Promise<any> {
    try {
      const normalizedKey = String(key).replace(/^user-uploads[,\/]/, 'user-uploads/').replace(/,/g, '/');
      
      console.log(`[ImageController] TEST endpoint - key: ${key} -> normalized: ${normalizedKey}`);
      
      // Test file existence
      const exists = await this.imageService.fileExists(normalizedKey);
      console.log(`[ImageController] TEST - File exists: ${exists}`);
      
      // Test presigned URL generation
      let presignedUrl = null;
      try {
        presignedUrl = await this.imageService.getPresignedViewUrl(normalizedKey, 3600);
        console.log(`[ImageController] TEST - Presigned URL generated: ${presignedUrl?.substring(0, 100)}...`);
      } catch (urlError: any) {
        console.error(`[ImageController] TEST - Presigned URL generation failed:`, urlError);
      }
      
      return {
        success: true,
        key: key,
        normalizedKey,
        fileExists: exists,
        presignedUrl: presignedUrl,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error(`[ImageController] TEST - Error:`, error);
      return {
        success: false,
        key: key,
        error: error?.message || 'Unknown error',
        stack: error?.stack,
      };
    }
  }

  // List images from cache/redis (metadata only) - MUST be last to avoid catching wildcard routes
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