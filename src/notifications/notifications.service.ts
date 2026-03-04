import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async createNotification(params: {
    userId: number;
    type: 'MESSAGE' | 'ESCROW' | 'XP' | 'PAYMENT' | 'LISTING_APPROVAL' | 'AD_APPROVAL' | 'SYSTEM';
    title: string;
    body?: string;
    data?: any;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type as any,
        title: params.title,
        body: params.body ?? null,
        data: params.data ?? undefined,
      },
    });

    this.gateway.emitToUser(params.userId, 'notifications.new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  emitToUser(userId: number, event: string, payload: any) {
    this.gateway.emitToUser(userId, event, payload);
  }

  async list(userId: number, unreadOnly?: boolean) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: number, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      return null;
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: number) {
    const updated = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return updated.count;
  }

  async delete(userId: number, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      return null;
    }
    return this.prisma.notification.delete({ where: { id } });
  }
}
