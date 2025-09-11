import {
  Controller,
  Post,
  Get,
  Delete,
  Put,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpStatus,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ImageService } from './image.service';
import { ImageMetadata, UploadedImageFile } from './types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EditImageDto } from './dto/upload-image.dto';

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  /**
   * Set common headers for image responses
   */
  private setImageHeaders(res: Response, metadata: ImageMetadata, isDownload = false): void {
    const headers = {
      'Content-Type': metadata.mimeType,
      'Content-Length': metadata.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': `"${metadata.id}-${metadata.uploadDate.getTime()}"`,
      'Last-Modified': metadata.uploadDate.toUTCString(),
      'Expires': new Date(Date.now() + 31536000 * 1000).toUTCString(),
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${metadata.filename}"`;
    }

    res.set(headers);
  }

  /**
   * Upload a new image to Contabo VPS
   * POST /images/upload
   */
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
      fileFilter: (req, file, cb) => {
        // Validate file type
        if (!file.mimetype.startsWith('image/')) {
          return cb(new HttpException('Only image files are allowed', HttpStatus.BAD_REQUEST), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: UploadedImageFile): Promise<ImageMetadata> {
    if (!file) {
      throw new HttpException('No image file provided', HttpStatus.BAD_REQUEST);
    }

    return this.imageService.uploadImage(file);
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
   * Serve image for display (inline viewing)
   * GET /images/:id/view
   */
  @Get(':id/view')
  async viewImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const metadata = await this.imageService.getImage(id);
      const imageBuffer = await this.imageService.getImageFile(id);
      
      this.setImageHeaders(res, metadata, false);
      res.end(imageBuffer);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Image not found' });
    }
  }

  /**
   * Download image file
   * GET /images/:id/download
   */
  @Get(':id/download')
  async downloadImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const metadata = await this.imageService.getImage(id);
      const imageBuffer = await this.imageService.getImageFile(id);
      
      this.setImageHeaders(res, metadata, true);
      res.end(imageBuffer);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Image not found' });
    }
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
   * Delete image from VPS
   * DELETE /images/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteImage(@Param('id') id: string): Promise<{ message: string; success: boolean }> {
    const success = await this.imageService.deleteImage(id);
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
    return this.imageService.editImageMetadata(id, editImageDto);
  }


}
