import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(private prisma: PrismaService) {}

  async addToWaitlist(email: string) {
    try {
      // Check if email already exists
      const existing = await this.prisma.waitlist.findUnique({
        where: { email },
      });

      if (existing) {
        throw new ConflictException('Email already registered in waitlist');
      }

      // Add to waitlist
      const waitlistEntry = await this.prisma.waitlist.create({
        data: { email },
      });

      this.logger.log(`New waitlist signup: ${email}`);
      
      return {
        success: true,
        message: 'Thank you for joining our waitlist!',
        email: waitlistEntry.email,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(`Waitlist signup failed: ${error.message}`);
      throw error;
    }
  }

  async getAllWaitlist() {
    return this.prisma.waitlist.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWaitlistCount() {
    return this.prisma.waitlist.count();
  }
}

