import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class JoinWaitlistDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private waitlistService: WaitlistService) {}

  /**
   * Join waitlist (Public)
   */
  @ApiOperation({ summary: 'Join waitlist with email' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.waitlistService.addToWaitlist(dto.email);
  }

  /**
   * Get all waitlist entries (Admin only)
   */
  @ApiOperation({ summary: 'Get all waitlist entries' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAllWaitlist() {
    return this.waitlistService.getAllWaitlist();
  }

  /**
   * Get waitlist count (Admin only)
   */
  @ApiOperation({ summary: 'Get waitlist count' })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @Get('count')
  async getCount() {
    const count = await this.waitlistService.getWaitlistCount();
    return { count };
  }
}

