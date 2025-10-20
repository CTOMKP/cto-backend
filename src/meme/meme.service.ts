import { Injectable, Logger, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../image/image.service';
import { Meme } from '@prisma/client';

export interface CreateMemeDto {
  filename: string;
  s3Key: string;
  s3Url: string;
  size: number;
  mimeType: string;
  uploadedById: number;
  description?: string;
  category?: string;
}

export interface UpdateMemeDto {
  filename?: string;
  description?: string;
  category?: string;
}

@Injectable()
export class MemeService {
  private readonly logger = new Logger(MemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageService: ImageService,
  ) {}

  /**
   * Create meme after successful S3 upload
   */
  async createMeme(data: CreateMemeDto): Promise<Meme> {
    try {
      const meme = await this.prisma.meme.create({
        data: {
          filename: data.filename,
          s3Key: data.s3Key,
          s3Url: data.s3Url,
          size: data.size,
          mimeType: data.mimeType,
          uploadedById: data.uploadedById,
          description: data.description,
          category: data.category,
        },
      });

      this.logger.log(`Meme created: ${meme.s3Key} by user ${meme.uploadedById}`);
      return meme;
    } catch (error) {
      this.logger.error('Failed to create meme:', error);
      throw new HttpException('Failed to create meme', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all memes (ordered by newest first)
   */
  async getAllMemes(): Promise<Meme[]> {
    return this.prisma.meme.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Get meme by ID
   */
  async getMemeById(id: string): Promise<Meme> {
    const meme = await this.prisma.meme.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!meme) {
      throw new NotFoundException(`Meme with ID ${id} not found`);
    }

    return meme;
  }

  /**
   * Get meme by S3 key
   */
  async getMemeByS3Key(s3Key: string): Promise<Meme> {
    const meme = await this.prisma.meme.findUnique({
      where: { s3Key },
    });

    if (!meme) {
      throw new NotFoundException(`Meme with S3 key ${s3Key} not found`);
    }

    return meme;
  }

  /**
   * Update meme metadata
   */
  async updateMeme(id: string, data: UpdateMemeDto): Promise<Meme> {
    try {
      // Verify meme exists
      await this.getMemeById(id);

      const meme = await this.prisma.meme.update({
        where: { id },
        data: {
          filename: data.filename,
          description: data.description,
          category: data.category,
        },
      });

      this.logger.log(`Meme updated: ${id}`);
      return meme;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update meme:', error);
      throw new HttpException('Failed to update meme', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete meme (database + S3)
   */
  async deleteMeme(id: string, userId: number, isAdmin: boolean): Promise<void> {
    try {
      const meme = await this.getMemeById(id);

      // Only allow admin or uploader to delete
      if (!isAdmin && meme.uploadedById !== userId) {
        throw new HttpException('Not authorized to delete this meme', HttpStatus.FORBIDDEN);
      }

      // Delete from S3
      await this.imageService.deleteImage(meme.s3Key);

      // Delete from database
      await this.prisma.meme.delete({
        where: { id },
      });

      this.logger.log(`Meme deleted: ${id} (S3: ${meme.s3Key})`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to delete meme:', error);
      throw new HttpException('Failed to delete meme', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Bulk import migrated memes
   */
  async bulkImportMemes(memes: CreateMemeDto[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const memeData of memes) {
      try {
        // Check if already exists by s3Key
        const existing = await this.prisma.meme.findUnique({
          where: { s3Key: memeData.s3Key },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await this.createMeme(memeData);
        imported++;
      } catch (error) {
        this.logger.error(`Failed to import meme ${memeData.s3Key}:`, error);
        skipped++;
      }
    }

    this.logger.log(`Bulk import complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }
}

