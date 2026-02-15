import { Controller, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List notifications for current user' })
  async list(@Req() req: any, @Query('unread') unread?: string) {
    const userId = req?.user?.userId || req?.user?.sub;
    const unreadOnly = unread === '1' || unread === 'true';
    const items = await this.notificationsService.list(Number(userId), unreadOnly);
    return { success: true, items };
  }

  @Post(':id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = req?.user?.userId || req?.user?.sub;
    const updated = await this.notificationsService.markRead(Number(userId), id);
    return { success: true, data: updated };
  }
}
