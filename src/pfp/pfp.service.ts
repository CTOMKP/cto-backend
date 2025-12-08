import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class PfpService {
  private readonly logger = new Logger(PfpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Save profile picture URL to user's avatarUrl field
   */
  async savePfp(userId: number, imageUrl: string) {
    try {
      // Verify user exists
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new UnauthorizedException('User not found');
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

