import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
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
  @ApiOperation({ 
    summary: 'Join waitlist with email',
    description: 'Add email to waitlist. Public endpoint, no authentication required.'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Successfully added to waitlist',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Email added to waitlist' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid email or email already in waitlist' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.waitlistService.addToWaitlist(dto.email);
  }

  /**
   * Get all waitlist entries (Admin only)
   */
  @ApiOperation({ 
    summary: 'Get all waitlist entries',
    description: 'Get all emails in the waitlist. Admin only. Requires JWT authentication.'
  })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ 
    status: 200, 
    description: 'Waitlist entries retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', example: 'user@example.com' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  @Get()
  async getAllWaitlist() {
    return this.waitlistService.getAllWaitlist();
  }

  /**
   * Get waitlist count (Admin only)
   */
  @ApiOperation({ 
    summary: 'Get waitlist count',
    description: 'Get total number of emails in the waitlist. Admin only. Requires JWT authentication.'
  })
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ 
    status: 200, 
    description: 'Waitlist count retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 150 }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Admin access required' })
  @Get('count')
  async getCount() {
    const count = await this.waitlistService.getWaitlistCount();
    return { count };
  }
}

