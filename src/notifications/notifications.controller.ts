import { Controller, Delete, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
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

  @Post('read-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark all notifications as read for current user' })
  async markAllRead(@Req() req: any) {
    const userId = req?.user?.userId || req?.user?.sub;
    const count = await this.notificationsService.markAllRead(Number(userId));
    return { success: true, count };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a notification for current user' })
  async deleteOne(@Req() req: any, @Param('id') id: string) {
    const userId = req?.user?.userId || req?.user?.sub;
    const deleted = await this.notificationsService.delete(Number(userId), id);
    return { success: true, data: deleted };
  }
}
