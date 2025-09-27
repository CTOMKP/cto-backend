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
      await this.imageService.getImage(normalizedKey); // ensure metadata exists or seed fallback
      const url = await this.imageService.getPresignedViewUrl(normalizedKey);
      res.set({ 'Cache-Control': 'no-store' }).redirect(url);
    } catch {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Image not found' });
    }
  }

  // Download redirect with content-disposition hint
  @Get('download/*key')
  async downloadImage(@Param('key') key: string, @Res() res: Response): Promise<void> {
    try {
      const url = await this.imageService.getPresignedViewUrl(key);
      res.set({
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(key.split('/').pop() || 'download')}"`,
      }).redirect(url);
    } catch {
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