import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MemeService, CreateMemeDto, UpdateMemeDto } from './meme.service';
import { ImageService } from '../image/image.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

class PresignMemeUploadDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  mimeType: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}

class UpdateMemeMetadataDto {
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

class BulkImportMemesDto {
  @IsNotEmpty()
  memes: CreateMemeDto[];
}

@ApiTags('Memes')
@Controller('memes')
export class MemeController {
  constructor(
    private readonly memeService: MemeService,
    private readonly imageService: ImageService,
  ) {}

  /**
   * Generate presigned URL for meme upload (Admin only)
   */
  @ApiOperation({ summary: 'Get presigned upload URL for meme' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Post('presign')
  async presignUpload(@Body() dto: PresignMemeUploadDto, @Req() req: any) {
    const userId = req?.user?.userId;
    const userRole = req?.user?.role;

    // Only admins can upload memes
    if (userRole !== 'ADMIN') {
      throw new HttpException('Only admins can upload memes', HttpStatus.FORBIDDEN);
    }

    // Get presigned URL from ImageService
    const result = await this.imageService.createPresignedUpload('meme', {
      userId: userId?.toString(),
      filename: dto.filename,
      mimeType: dto.mimeType,
    });

    // Generate CloudFront URL for permanent access (don't store presigned URL)
    const cloudfrontDomain = this.configService.get<string>('CLOUDFRONT_DOMAIN', 'd2cjbd1iqkwr9j.cloudfront.net');
    const cloudfrontUrl = `https://${cloudfrontDomain}/${result.key}`;

    // Create database entry for the meme (store CloudFront URL, not presigned URL)
    const meme = await this.memeService.createMeme({
      filename: dto.filename,
      s3Key: result.key,
      s3Url: cloudfrontUrl, // Store CloudFront URL instead of presigned URL
      size: dto.size || 0,
      mimeType: dto.mimeType,
      uploadedById: userId,
    });

    return {
      uploadUrl: result.uploadUrl,
      key: result.key, // Return S3 key (not database ID) so frontend can build CloudFront URL
      s3Key: result.key, // Explicitly include S3 key
      viewUrl: cloudfrontUrl,
      url: cloudfrontUrl, // Return CloudFront URL
      memeId: meme.id,
      metadata: {
        id: meme.id, // Database ID
        filename: meme.filename,
        size: meme.size,
        mimeType: meme.mimeType,
        url: cloudfrontUrl, // Return CloudFront URL
        originalName: meme.filename,
        uploadDate: new Date().toISOString(),
        path: result.key, // Include S3 key path
      },
    };
  }

  /**
   * Get all memes (Public)
   */
  @ApiOperation({ summary: 'Get all memes' })
  @Get()
  async getAllMemes() {
    const memes = await this.memeService.getAllMemes();
    // Get CloudFront domain or use direct S3 URL
    const cloudfrontDomain = this.configService.get<string>('CLOUDFRONT_DOMAIN', 'd2cjbd1iqkwr9j.cloudfront.net');
    
    // Map to frontend format: generate CloudFront URLs from S3 keys
    return memes.map(meme => {
      // Generate CloudFront URL from S3 key (don't use stored presigned URL)
      const cloudfrontUrl = `https://${cloudfrontDomain}/${meme.s3Key}`;
      
      return {
        id: meme.id,
        url: cloudfrontUrl,
        filename: meme.filename,
        originalName: meme.filename,
        size: meme.size,
        uploadDate: meme.createdAt.toISOString(),
        description: meme.description,
        category: meme.category,
        mimeType: meme.mimeType,
      };
    });
  }

  /**
   * Download meme (Public)
   */
  @ApiOperation({ summary: 'Download meme' })
  @Get(':id/download')
  async downloadMeme(@Param('id') id: string, @Res() res: Response) {
    try {
      const meme = await this.memeService.getMemeById(id);
      const filename = meme.filename || 'download';
      const downloadUrl = await this.imageService.getPresignedDownloadUrl(meme.s3Key, filename, 300);
      res.redirect(downloadUrl);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({ message: 'Meme not found' });
    }
  }

  /**
   * Get meme by ID (Public)
   */
  @ApiOperation({ summary: 'Get meme by ID' })
  @Get(':id')
  async getMemeById(@Param('id') id: string) {
    const meme = await this.memeService.getMemeById(id);
    // Map to frontend format
    return {
      ...meme,
      url: meme.s3Url,
      originalName: meme.filename,
      uploadDate: meme.createdAt.toISOString(),
    };
  }

  /**
   * Update meme metadata (Admin only)
   */
  @ApiOperation({ summary: 'Update meme metadata' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateMeme(
    @Param('id') id: string,
    @Body() dto: UpdateMemeMetadataDto,
    @Req() req: any,
  ) {
    const userRole = req?.user?.role;

    if (userRole !== 'ADMIN') {
      throw new HttpException('Only admins can update memes', HttpStatus.FORBIDDEN);
    }

    return this.memeService.updateMeme(id, dto);
  }

  /**
   * Delete meme (Admin only)
   */
  @ApiOperation({ summary: 'Delete meme' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteMeme(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.userId;
    const userRole = req?.user?.role;
    const isAdmin = userRole === 'ADMIN';

    await this.memeService.deleteMeme(id, userId, isAdmin);

    return {
      message: 'Meme deleted successfully',
      success: true,
    };
  }

  /**
   * Bulk import migrated memes (Admin only)
   */
  @ApiOperation({ summary: 'Bulk import memes from migration' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Post('bulk-import')
  async bulkImport(@Body() dto: BulkImportMemesDto, @Req() req: any) {
    const userRole = req?.user?.role;

    if (userRole !== 'ADMIN') {
      throw new HttpException('Only admins can import memes', HttpStatus.FORBIDDEN);
    }

    const result = await this.memeService.bulkImportMemes(dto.memes);

    return {
      message: `Successfully imported ${result.imported} memes (${result.skipped} skipped)`,
      imported: result.imported,
      skipped: result.skipped,
    };
  }
}

