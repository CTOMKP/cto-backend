import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

@Injectable()
export class SupportTicketService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, dto: CreateSupportTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject.trim(),
        category: (dto.category || 'GENERAL').toUpperCase(),
        priority: (dto.priority || 'NORMAL').toUpperCase(),
        message: dto.message.trim(),
      },
    });
  }

  async listMine(userId: number, limit = 20) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async listAll(requestingRole: string, limit = 50) {
    const role = (requestingRole || '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'MODERATOR') {
      throw new ForbiddenException('Only admins can view all support tickets');
    }

    return this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }
}

