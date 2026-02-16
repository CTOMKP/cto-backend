import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XpService } from '../xp/xp.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: XpService,
    private readonly notifications: NotificationsService,
  ) {}

  private async getConversationForUser(userId: number, conversationId: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { ad: true },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.posterId !== userId && convo.applicantId !== userId) {
      throw new ForbiddenException('Not authorized for this conversation');
    }
    return convo;
  }

  async applyToAd(userId: number, adId: string, coverLetter: string) {
    if (!coverLetter || coverLetter.trim().length < 500) {
      throw new BadRequestException('Cover letter must be at least 500 characters');
    }

    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId === userId) throw new BadRequestException('You cannot apply to your own ad');

    const existing = await this.prisma.conversation.findFirst({
      where: { adId, applicantId: userId },
    });

    let conversation = existing;
    if (!conversation) {
      // Spend XP for starting a new conversation
      await this.xpService.spend(userId, 8, 'start_conversation', { adId });
      conversation = await this.prisma.conversation.create({
        data: {
          adId,
          posterId: ad.userId,
          applicantId: userId,
          status: 'ACTIVE',
          lastMessageAt: new Date(),
          lastMessagePreview: coverLetter.slice(0, 120),
        },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        receiverId: ad.userId,
        type: 'COVER_LETTER',
        body: coverLetter.trim(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: coverLetter.trim().slice(0, 120),
      },
    });

    await this.prisma.marketplaceAd.update({
      where: { id: adId },
      data: {
        messageCount: { increment: 1 },
        lastInteractionAt: new Date(),
      },
    });

    await this.prisma.marketplaceAdInteraction.create({
      data: { adId, userId, type: 'APPLY' },
    });

    await this.notifications.createNotification({
      userId: ad.userId,
      type: 'MESSAGE',
      title: 'New application received',
      body: ad.title,
      data: { adId, conversationId: conversation.id },
    });

    this.notifications.emitToUser(ad.userId, 'messages.new', {
      conversationId: conversation.id,
      message,
    });

    await this.notifications.createNotification({
      userId,
      type: 'MESSAGE',
      title: 'Application sent',
      body: ad.title,
      data: { adId, conversationId: conversation.id },
    });

    this.notifications.emitToUser(userId, 'messages.new', {
      conversationId: conversation.id,
      message,
    });

    return { conversation, message };
  }

  async listConversations(userId: number) {
    const items = await this.prisma.conversation.findMany({
      where: {
        OR: [{ posterId: userId }, { applicantId: userId }],
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        ad: { include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } } },
        poster: { select: { id: true, name: true, avatarUrl: true, email: true } },
        applicant: { select: { id: true, name: true, avatarUrl: true, email: true } },
      },
    });
    const withUnread = await Promise.all(
      items.map(async (c) => {
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: c.id,
            receiverId: userId,
            readAt: null,
          },
        });
        return { ...c, unreadCount };
      }),
    );
    return withUnread;
  }

  async getConversation(userId: number, conversationId: string) {
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        ad: { include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } } },
        poster: { select: { id: true, name: true, avatarUrl: true, email: true } },
        applicant: { select: { id: true, name: true, avatarUrl: true, email: true } },
      },
    });
  }

  async listMessages(userId: number, conversationId: string) {
    await this.getConversationForUser(userId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        reactions: {
          select: { id: true, userId: true, emoji: true, createdAt: true },
        },
      },
    });
  }

  async sendMessage(userId: number, conversationId: string, body: string) {
    if (!body || !body.trim()) throw new BadRequestException('Message is required');
    const convo = await this.getConversationForUser(userId, conversationId);
    const receiverId = convo.posterId === userId ? convo.applicantId : convo.posterId;

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        receiverId,
        type: 'MESSAGE',
        body: body.trim(),
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: body.trim().slice(0, 120),
      },
    });

    await this.prisma.marketplaceAd.update({
      where: { id: convo.adId },
      data: {
        messageCount: { increment: 1 },
        lastInteractionAt: new Date(),
      },
    });

    await this.prisma.marketplaceAdInteraction.create({
      data: { adId: convo.adId, userId, type: 'MESSAGE' },
    });

    await this.notifications.createNotification({
      userId: receiverId,
      type: 'MESSAGE',
      title: 'New message',
      body: convo.ad?.title || 'Marketplace conversation',
      data: { conversationId },
    });

    this.notifications.emitToUser(receiverId, 'messages.new', {
      conversationId,
      message,
    });

    return message;
  }

  async markRead(userId: number, conversationId: string) {
    await this.getConversationForUser(userId, conversationId);
    await this.prisma.message.updateMany({
      where: { conversationId, receiverId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async toggleReaction(userId: number, messageId: string, emoji: string) {
    if (!emoji || !emoji.trim()) throw new BadRequestException('Emoji is required');
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    const convo = message.conversation;
    if (convo.posterId !== userId && convo.applicantId !== userId) {
      throw new ForbiddenException('Not authorized for this conversation');
    }

    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji: emoji.trim() } },
    });

    let action: 'added' | 'removed' = 'added';
    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      action = 'removed';
    } else {
      await this.prisma.messageReaction.create({
        data: {
          messageId,
          userId,
          emoji: emoji.trim(),
        },
      });
    }

    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      select: { id: true, userId: true, emoji: true, createdAt: true },
    });

    const payload = { conversationId: message.conversationId, messageId, reactions, action };
    this.notifications.emitToUser(convo.posterId, 'messages.reaction', payload);
    this.notifications.emitToUser(convo.applicantId, 'messages.reaction', payload);

    return { messageId, reactions, action };
  }
}
