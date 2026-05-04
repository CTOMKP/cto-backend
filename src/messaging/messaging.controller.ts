import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiResponse({
    status: 201,
    description: 'Application submitted successfully',
    schema: {
      example: {
        success: true,
        conversationId: 'cmox-thread-123',
        applicationId: 'cmox-app-456',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request or insufficient XP' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async apply(@Req() req: any, @Param('adId') adId: string, @Body('coverLetter') coverLetter: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.messagingService.applyToAd(userId, adId, coverLetter);
  }

  @Get('threads')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List message threads for current user' })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved',
    schema: {
      example: {
        success: true,
        items: [
          {
            id: 'cmox-thread-123',
            adId: 'cmo50d96i00d6hjmc7o4mwq6b',
            lastMessageAt: '2026-05-04T10:11:22.000Z',
            unreadCount: 1,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listThreads(@Req() req: any) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const items = await this.messagingService.listConversations(userId);
    return { success: true, items };
  }

  @Get('threads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a conversation and messages' })
  @ApiResponse({
    status: 200,
    description: 'Conversation and messages retrieved',
    schema: {
      example: {
        success: true,
        conversation: {
          id: 'cmox-thread-123',
          adId: 'cmo50d96i00d6hjmc7o4mwq6b',
        },
        messages: [
          {
            id: 'cmox-msg-1',
            body: 'Hi, I can handle this task.',
            createdAt: '2026-05-04T10:20:00.000Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
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
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
    schema: {
      example: {
        success: true,
        message: {
          id: 'cmox-msg-2',
          body: 'Let us proceed.',
          createdAt: '2026-05-04T10:22:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid message body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendMessage(@Req() req: any, @Param('id') id: string, @Body('body') body: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const message = await this.messagingService.sendMessage(userId, id, body);
    return { success: true, message };
  }

  @Post('threads/:id/read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark conversation messages as read' })
  @ApiResponse({
    status: 200,
    description: 'Messages marked as read',
    schema: {
      example: {
        success: true,
        updatedCount: 3,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    return this.messagingService.markRead(userId, id);
  }

  @Post('reactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Toggle emoji reaction for a message' })
  @ApiResponse({
    status: 200,
    description: 'Reaction toggled',
    schema: {
      example: {
        success: true,
        added: true,
        emoji: '🔥',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async toggleReaction(@Req() req: any, @Param('id') id: string, @Body('emoji') emoji: string) {
    const userId = Number(req?.user?.userId || req?.user?.sub);
    const result = await this.messagingService.toggleReaction(userId, id, emoji);
    return { success: true, ...result };
  }
}
