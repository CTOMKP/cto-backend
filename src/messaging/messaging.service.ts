import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { XpService } from '../xp/xp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { START_CONVERSATION_XP_COST, XP_REASONS } from '../xp/xp.constants';
import { CreateGeneralConversationDto } from './dto/create-general-conversation.dto';

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
      include: {
        ad: { include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } } },
        poster: { select: { id: true, name: true, avatarUrl: true, email: true } },
        applicant: { select: { id: true, name: true, avatarUrl: true, email: true } },
        participantStates: { where: { userId } },
      },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.posterId !== userId && convo.applicantId !== userId) {
      throw new ForbiddenException('Not authorized for this conversation');
    }
    return convo;
  }

  private directConversationKey(firstUserId: number, secondUserId: number): string {
    return [firstUserId, secondUserId].sort((a, b) => a - b).join(':');
  }

  private async restoreForParticipants(conversationId: string, userIds: number[]) {
    await this.prisma.$transaction(
      Array.from(new Set(userIds)).map((userId) =>
        this.prisma.conversationParticipantState.upsert({
          where: { conversationId_userId: { conversationId, userId } },
          create: { conversationId, userId, archivedAt: null },
          update: { archivedAt: null },
        }),
      ),
    );
  }

  async createGeneralConversation(userId: number, dto: CreateGeneralConversationDto) {
    if (dto.recipientUserId === userId) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }

    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.recipientUserId },
      select: { id: true },
    });
    if (!recipient) throw new NotFoundException('Recipient user not found');

    const directKey = this.directConversationKey(userId, recipient.id);
    const conversation = await this.prisma.conversation.upsert({
      where: { directKey },
      create: {
        type: ConversationType.GENERAL,
        directKey,
        posterId: userId,
        applicantId: recipient.id,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE' },
    });

    await this.restoreForParticipants(conversation.id, [userId]);
    const initialMessage = dto.initialMessage?.trim();
    const message = initialMessage
      ? await this.sendMessage(userId, conversation.id, initialMessage)
      : null;

    return {
      success: true,
      conversation: await this.getConversation(userId, conversation.id),
      message,
    };
  }

  async applyToAd(userId: number, adId: string, coverLetter: string) {
    if (!coverLetter || coverLetter.trim().length < 500) {
      throw new BadRequestException('Cover letter must be at least 500 characters');
    }

    const ad = await this.prisma.marketplaceAd.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.userId === userId) throw new BadRequestException('You cannot apply to your own ad');

    const existing = await this.prisma.conversation.findFirst({
      where: { adId, applicantId: userId, type: ConversationType.MARKETPLACE },
    });

    let conversation = existing;
    if (!conversation) {
      // Spend XP for starting a new conversation
      await this.xpService.spend(
        userId,
        START_CONVERSATION_XP_COST,
        XP_REASONS.START_CONVERSATION,
        { adId },
      );
      conversation = await this.prisma.conversation.create({
        data: {
          type: ConversationType.MARKETPLACE,
          adId,
          posterId: ad.userId,
          applicantId: userId,
          status: 'ACTIVE',
          lastMessageAt: new Date(),
          lastMessagePreview: coverLetter.slice(0, 120),
        },
      });
    }

    await this.restoreForParticipants(conversation.id, [conversation.posterId, conversation.applicantId]);

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

  async listConversations(
    userId: number,
    type?: ConversationType,
    archived = false,
  ) {
    const items = await this.prisma.conversation.findMany({
      where: {
        OR: [{ posterId: userId }, { applicantId: userId }],
        ...(type ? { type } : {}),
        participantStates: archived
          ? { some: { userId, archivedAt: { not: null } } }
          : { none: { userId, archivedAt: { not: null } } },
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        ad: { include: { user: { select: { id: true, name: true, avatarUrl: true, email: true } } } },
        poster: { select: { id: true, name: true, avatarUrl: true, email: true } },
        applicant: { select: { id: true, name: true, avatarUrl: true, email: true } },
        participantStates: { where: { userId } },
      },
    });

    const unreadGroups = items.length
      ? await this.prisma.message.groupBy({
          by: ['conversationId'],
          where: {
            conversationId: { in: items.map((item) => item.id) },
            receiverId: userId,
            readAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const unreadByConversation = new Map(
      unreadGroups.map((group) => [group.conversationId, group._count._all]),
    );

    return items.map(({ participantStates, ...conversation }) => {
      const archivedAt = participantStates[0]?.archivedAt ?? null;
      return {
        ...conversation,
        archivedAt,
        isArchived: Boolean(archivedAt),
        unreadCount: unreadByConversation.get(conversation.id) || 0,
      };
    });
  }

  async getConversation(userId: number, conversationId: string) {
    const { participantStates, ...conversation } = await this.getConversationForUser(
      userId,
      conversationId,
    );
    const archivedAt = participantStates[0]?.archivedAt ?? null;
    return {
      ...conversation,
      archivedAt,
      isArchived: Boolean(archivedAt),
    };
  }

  async setArchived(userId: number, conversationId: string, archived: boolean) {
    await this.getConversationForUser(userId, conversationId);
    const state = await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: {
        conversationId,
        userId,
        archivedAt: archived ? new Date() : null,
      },
      update: { archivedAt: archived ? new Date() : null },
    });
    return {
      success: true,
      conversationId,
      archivedAt: state.archivedAt,
      isArchived: Boolean(state.archivedAt),
    };
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
    await this.restoreForParticipants(conversationId, [userId, receiverId]);

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
        status: 'ACTIVE',
      },
    });

    if (convo.type === ConversationType.MARKETPLACE && convo.adId) {
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
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await this.notifications.createNotification({
      userId: receiverId,
      type: 'MESSAGE',
      title: 'New message',
      body:
        convo.type === ConversationType.MARKETPLACE
          ? convo.ad?.title || 'Marketplace conversation'
          : sender?.name || 'General conversation',
      data: { conversationId, conversationType: convo.type },
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

    if (action === 'added') {
      const otherUserId = message.senderId === userId ? message.receiverId : message.senderId;
      if (otherUserId && otherUserId !== userId) {
        await this.notifications.createNotification({
          userId: otherUserId,
          type: 'MESSAGE',
          title: 'New reaction',
          body: `${emoji.trim()} on your message`,
          data: { conversationId: message.conversationId, messageId, emoji: emoji.trim() },
        });
      }
    }

    const payload = { conversationId: message.conversationId, messageId, reactions, action };
    this.notifications.emitToUser(convo.posterId, 'messages.reaction', payload);
    this.notifications.emitToUser(convo.applicantId, 'messages.reaction', payload);

    return { messageId, reactions, action };
  }
}
