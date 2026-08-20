import { Injectable, Logger, BadRequestException, UnauthorizedException, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';

export const DEFAULT_MASCOT_TRAIT_KEYS = [
  "ARTIST",
  "ARTIST2",
  "ARTIST3",
  "CTO",
  "CTO2",
  "DEGEN",
  "DEGEN2",
  "DEV",
  "EARLYADT.WHALE",
  "HACKER",
  "HACKER2",
  "HACKER3",
  "HODLER",
  "KOL",
  "MOD",
  "MOD2",
  "MOD3",
  "NEWBIE",
  "SHILLER",
  "VISIONARY",
  "VISIONARY2",
  "WHALE",
  "WHALE2",
  "WHALE3",
] as const;

export const DEFAULT_MASCOT_V2_KEYS = Array.from(
  { length: 146 },
  (_, index) => `V2_${String(index + 1).padStart(5, '0')}`,
);

type MascotCatalogVersion = 'v1' | 'v2';

interface MascotCatalog {
  version: MascotCatalogVersion;
  keys: string[];
}

@Injectable()
export class PfpService {
  private readonly logger = new Logger(PfpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private getLegacyMascotKeys(): string[] {
    const configured = String(process.env.MASCOT_TRAIT_KEYS || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const keys =
      configured.length > 0 ? configured : [...DEFAULT_MASCOT_TRAIT_KEYS];
    const uniqueKeys = [...new Set(keys)];
    const invalidKey = uniqueKeys.find((key) => !/^[A-Za-z0-9._-]+$/.test(key));
    if (invalidKey || uniqueKeys.length === 0) {
      throw new ServiceUnavailableException(
        "MASCOT_TRAIT_KEYS contains an invalid mascot asset key",
      );
    }
    return uniqueKeys;
  }

  private parseConfiguredKeys(value: string): string[] {
    return value
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
  }

  private validateMascotKeys(keys: string[], environmentKey: string): string[] {
    const uniqueKeys = [...new Set(keys)];
    const invalidKey = uniqueKeys.find((key) => !/^[A-Za-z0-9._-]+$/.test(key));
    if (invalidKey || uniqueKeys.length === 0) {
      throw new ServiceUnavailableException(
        `${environmentKey} contains an invalid mascot asset key`,
      );
    }
    return uniqueKeys;
  }

  private getActiveMascotCatalog(): MascotCatalog {
    const requestedVersion = String(
      process.env.MASCOT_CATALOG_VERSION || 'v2',
    )
      .trim()
      .toLowerCase();

    if (requestedVersion === 'v1') {
      return { version: 'v1', keys: this.getLegacyMascotKeys() };
    }

    if (requestedVersion !== 'v2') {
      throw new ServiceUnavailableException(
        'MASCOT_CATALOG_VERSION must be either v1 or v2',
      );
    }

    const configured = this.parseConfiguredKeys(
      String(process.env.MASCOT_PFP_KEYS || ''),
    );
    const keys = configured.length > 0 ? configured : DEFAULT_MASCOT_V2_KEYS;
    const validated = this.validateMascotKeys(keys, 'MASCOT_PFP_KEYS');
    const invalidV2Key = validated.find((key) => !key.startsWith('V2_'));
    if (invalidV2Key) {
      throw new ServiceUnavailableException(
        'MASCOT_PFP_KEYS entries must start with V2_',
      );
    }

    return { version: 'v2', keys: validated };
  }

  private getAssignmentAsset(mascotKey: string) {
    if (mascotKey.startsWith('V2_')) {
      const filename = mascotKey.slice(3);
      const prefix = String(
        process.env.MASCOT_V2_ASSET_PREFIX || 'mascots/v2/full',
      ).replace(/^\/+|\/+$/g, '');
      return {
        assetVersion: 'v2' as const,
        assetPath: `${prefix}/${filename}.png`,
      };
    }

    return {
      assetVersion: 'v1' as const,
      assetPath: `mascots/TRAITS/${mascotKey}.png`,
    };
  }

  private assignmentResponse(
    assignment: { mascotKey: string; assignedAt: Date },
    catalogSize: number,
  ) {
    const asset = this.getAssignmentAsset(assignment.mascotKey);
    return {
      success: true,
      mascotKey: assignment.mascotKey,
      assignedAt: assignment.assignedAt,
      catalogSize,
      ...asset,
    };
  }

  async getOrAssignMascot(userId: number) {
    const user = await this.authService.getUserById(userId);
    if (!user) throw new UnauthorizedException("User not found");

    const catalog = this.getActiveMascotCatalog();
    const mascotKeys = catalog.keys;
    const existing = await this.prisma.mascotAssignment.findUnique({
      where: { userId },
    });
    if (existing) return this.assignmentResponse(existing, mascotKeys.length);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const assignment = await this.prisma.$transaction(
          async (database) => {
            const assigned = await database.mascotAssignment.findUnique({
              where: { userId },
            });
            if (assigned) return assigned;

            const usage = await database.mascotAssignment.groupBy({
              by: ["mascotKey"],
              where: { mascotKey: { in: mascotKeys } },
              _count: { mascotKey: true },
            });
            const counts = new Map(
              usage.map((row) => [row.mascotKey, row._count.mascotKey]),
            );
            const minimumUsage = Math.min(
              ...mascotKeys.map((key) => counts.get(key) || 0),
            );
            const leastUsed = mascotKeys.filter(
              (key) => (counts.get(key) || 0) === minimumUsage,
            );
            const mascotKey = leastUsed[randomInt(leastUsed.length)];

            return database.mascotAssignment.create({
              data: { userId, mascotKey },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.assignmentResponse(assignment, mascotKeys.length);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const assigned = await this.prisma.mascotAssignment.findUnique({
            where: { userId },
          });
          if (assigned)
            return this.assignmentResponse(assigned, mascotKeys.length);
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      "Could not allocate a mascot. Please try again.",
    );
  }

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
