import { Injectable, Logger, BadRequestException, UnauthorizedException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';

@Injectable()
export class PfpService {
  private readonly logger = new Logger(PfpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Extract S3 key from image URL
   * Handles both backend view URLs and direct S3 URLs
   */
  private extractS3Key(imageUrl: string): string | null {
    try {
      // If it's a backend view URL: https://api.ctomarketplace.com/api/v1/images/view/user-uploads/70/profile/...
      const viewUrlMatch = imageUrl.match(/\/api\/v1\/images\/view\/(.+)$/);
      if (viewUrlMatch) {
        return decodeURIComponent(viewUrlMatch[1]);
      }

      // If it's a direct S3 URL: https://bucket.s3.region.amazonaws.com/user-uploads/...
      const s3UrlMatch = imageUrl.match(/s3[.-][^/]+\.amazonaws\.com\/(.+)$/);
      if (s3UrlMatch) {
        return decodeURIComponent(s3UrlMatch[1].split('?')[0]); // Remove query params
      }

      // If it's a CloudFront URL: https://d2cjbd1iqkwr9j.cloudfront.net/user-uploads/...
      const cloudfrontMatch = imageUrl.match(/cloudfront\.net\/(.+)$/);
      if (cloudfrontMatch) {
        return decodeURIComponent(cloudfrontMatch[1].split('?')[0]);
      }

      // If it's already just a key path
      if (imageUrl.startsWith('user-uploads/')) {
        return imageUrl;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to extract S3 key from URL: ${imageUrl}`, error);
      return null;
    }
  }

  /**
   * Save profile picture URL to user's avatarUrl field
   * Verifies the file exists in S3 before saving
   */
  async savePfp(userId: number, imageUrl: string) {
    try {
      // Verify user exists
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Extract S3 key from URL and verify file exists
      const s3Key = this.extractS3Key(imageUrl);
      if (s3Key && this.storage && typeof this.storage.fileExists === 'function') {
        try {
          const exists = await this.storage.fileExists(s3Key);
          if (!exists) {
            this.logger.warn(`File does not exist in S3 for user ${userId}: ${s3Key}`);
            // Don't throw error - just log warning, as the file might be propagating
            // But we should still save the URL so the user can retry later
          } else {
            this.logger.log(`✅ Verified file exists in S3: ${s3Key}`);
          }
        } catch (verifyError: any) {
          this.logger.warn(`Could not verify file existence in S3: ${verifyError?.message || verifyError}`);
          // Continue anyway - file might exist but verification failed
        }
      } else if (s3Key) {
        this.logger.warn(`Storage provider does not support fileExists check for key: ${s3Key}`);
      } else {
        this.logger.warn(`Could not extract S3 key from URL: ${imageUrl}`);
      }

      // Update user's avatarUrl
      const updatedUser = await this.authService.updateUser(userId, { avatarUrl: imageUrl });

      this.logger.log(`Profile picture saved for user ${userId}: ${imageUrl}`);

      return {
        success: true,
        message: 'Profile picture saved successfully',
        avatarUrl: updatedUser.avatarUrl,
      };
    } catch (error) {
      this.logger.error(`Failed to save PFP for user ${userId}:`, error);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new BadRequestException(`Failed to save profile picture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

