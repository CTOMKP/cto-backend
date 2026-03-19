import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagingService } from './messaging.service';

@ApiTags('messages')
@Controller('messages')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('apply/:adId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Apply to a marketplace ad with a cover letter (costs 15 XP)' })
  async apply(@Req() req: any, @Param('adId') adId: string, @Body('coverLetter') coverLetter: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.messagingService.applyToAd(userId, adId, coverLetter);
  }

  @Get('threads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List message threads for current user' })
  async listThreads(@Req() req: any) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const items = await this.messagingService.listConversations(userId);
    return { success: true, items };
  }

  @Get('threads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a conversation and messages' })
  async getThread(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const conversation = await this.messagingService.getConversation(userId, id);
    const messages = await this.messagingService.listMessages(userId, id);
    return { success: true, conversation, messages };
  }

  @Post('threads/:id/messages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Send a message' })
  async sendMessage(@Req() req: any, @Param('id') id: string, @Body('body') body: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const message = await this.messagingService.sendMessage(userId, id, body);
    return { success: true, message };
  }

  @Post('threads/:id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark conversation messages as read' })
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.messagingService.markRead(userId, id);
  }

  @Post('reactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Toggle emoji reaction for a message' })
  async toggleReaction(@Req() req: any, @Param('id') id: string, @Body('emoji') emoji: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const result = await this.messagingService.toggleReaction(userId, id, emoji);
    return { success: true, ...result };
  }
}
