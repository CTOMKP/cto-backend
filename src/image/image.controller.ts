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
import { ImageService, ImageMetadata } from './image.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EditImageDto } from './dto/upload-image.dto';

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

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
  async uploadImage(@UploadedFile() file: any): Promise<ImageMetadata> {
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
   * Download image file from VPS
   * GET /images/:id/download
   */
  @Get(':id/download')
  async downloadImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const imageBuffer = await this.imageService.getImageFile(id);
      const metadata = await this.imageService.getImage(id);
      
      // Ultra-fast response headers for maximum speed
      res.set({
        'Content-Type': metadata.mimeType,
        'Content-Disposition': `attachment; filename="${metadata.originalName}"`,
        'Content-Length': imageBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000', // 1 year cache
        'ETag': `"${metadata.id}"`,
        'Accept-Ranges': 'bytes',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      
      res.send(imageBuffer);
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

  /**
   * Health check for image service
   * GET /images/health
   */
  @Get('health/status')
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  }

}
