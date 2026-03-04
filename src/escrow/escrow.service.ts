import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MovementPaymentService } from '../payment/movement-payment.service';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly movementPaymentService: MovementPaymentService,
  ) {}

  private ensurePoster(escrow: any, userId: number) {
    if (escrow.posterId !== userId) throw new ForbiddenException('Poster only');
  }

  private ensureApplicant(escrow: any, userId: number) {
    if (escrow.applicantId !== userId) throw new ForbiddenException('Applicant only');
  }

  private ensureParticipant(escrow: any, userId: number) {
    if (escrow.posterId !== userId && escrow.applicantId !== userId) {
      throw new ForbiddenException('Not a participant');
    }
  }

  private ensureNotFrozen(escrow: any) {
    if (escrow.isFrozen) {
      throw new BadRequestException('Escrow is frozen by admin');
    }
  }

  async createOffer(userId: number, conversationId: string, payload: any) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.posterId !== userId) throw new ForbiddenException('Only poster can create escrow');

    const totalAmount = Number(payload?.totalAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new BadRequestException('Invalid total amount');
    }

    const escrow = await this.prisma.escrow.create({
      data: {
        adId: convo.adId,
        conversationId: convo.id,
        posterId: convo.posterId,
        applicantId: convo.applicantId,
        title: payload?.title || 'Escrow Offer',
        totalAmount,
        currency: payload?.currency || 'USDC',
        deadline: payload?.deadline ? new Date(payload.deadline) : null,
        noDeadline: Boolean(payload?.noDeadline),
        status: 'PROPOSED',
        milestones: payload?.milestones?.length
          ? {
              create: payload.milestones.map((m: any) => ({
                title: m.title,
                amount: Number(m.amount || 0),
                dueDate: m.dueDate ? new Date(m.dueDate) : null,
              })),
            }
          : undefined,
      },
      include: { milestones: true },
    });

    await this.notifications.createNotification({
      userId: convo.applicantId,
      type: 'ESCROW',
      title: 'Escrow offer received',
      body: payload?.title || 'Escrow offer',
      data: { escrowId: escrow.id, conversationId: convo.id },
    });

    await this.notifications.createNotification({
      userId: convo.posterId,
      type: 'ESCROW',
      title: 'Escrow offer sent',
      body: payload?.title || 'Escrow offer',
      data: { escrowId: escrow.id, conversationId: convo.id },
    });

    this.notifications.emitToUser(convo.posterId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: convo.id,
    });
    this.notifications.emitToUser(convo.applicantId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: convo.id,
    });

    return escrow;
  }

  async getEscrow(userId: number, escrowId: string) {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
      include: { milestones: true, ad: true },
    });
    if (!escrow) throw new NotFoundException('Escrow not found');
    this.ensureParticipant(escrow, userId);
    return escrow;
  }

  async getLatestByConversation(userId: number, conversationId: string) {
    const escrow = await this.prisma.escrow.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      include: { milestones: true, ad: true },
    });
    if (!escrow) throw new NotFoundException('Escrow not found');
    this.ensureParticipant(escrow, userId);
    return escrow;
  }

  private async getEscrowForAction(userId: number, escrowId: string, byAdmin = false) {
    if (byAdmin) {
      const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
      if (!escrow) throw new NotFoundException('Escrow not found');
      return escrow;
    }

    return this.getEscrow(userId, escrowId);
  }


  async accept(userId: number, escrowId: string) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensureApplicant(escrow, userId);
    if (escrow.status !== 'PROPOSED') {
      throw new BadRequestException('Escrow not in proposed state');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'AWAITING_PAYMENT', acceptedAt: new Date() },
    });
    await this.notifyBoth(updated, 'Escrow accepted');
    return updated;
  }

  async decline(userId: number, escrowId: string) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensureApplicant(escrow, userId);
    if (escrow.status !== 'PROPOSED') {
      throw new BadRequestException('Escrow not in proposed state');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'DECLINED', cancelledAt: new Date() },
    });
    await this.notifyBoth(updated, 'Escrow declined');
    return updated;
  }

  async fund(userId: number, escrowId: string) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensurePoster(escrow, userId);
    if (escrow.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException('Escrow not awaiting payment');
    }
    const payment = await this.movementPaymentService.createEscrowPayment(userId, escrowId, escrow.totalAmount);
    await this.notifications.createNotification({
      userId: escrow.applicantId,
      type: 'ESCROW',
      title: 'Escrow funding initiated',
      body: escrow.title,
      data: { escrowId: escrow.id, paymentId: payment.paymentId, conversationId: escrow.conversationId },
    });
    await this.notifications.createNotification({
      userId: escrow.posterId,
      type: 'ESCROW',
      title: 'Escrow funding initiated',
      body: escrow.title,
      data: { escrowId: escrow.id, paymentId: payment.paymentId, conversationId: escrow.conversationId },
    });
    this.notifications.emitToUser(escrow.posterId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: escrow.conversationId,
    });
    this.notifications.emitToUser(escrow.applicantId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: escrow.conversationId,
    });
    return { escrow, payment };
  }

  async submitWork(userId: number, escrowId: string) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensureApplicant(escrow, userId);
    if (escrow.status !== 'FUNDED_ACTIVE') {
      throw new BadRequestException('Escrow not active');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'UNDER_REVIEW', submittedAt: new Date() },
    });
    await this.notifyBoth(updated, 'Work submitted for review');
    return updated;
  }

  async release(userId: number, escrowId: string, byAdmin = false) {
    const escrow = await this.getEscrowForAction(userId, escrowId, byAdmin);
    if (!byAdmin) this.ensureNotFrozen(escrow);
    if (!byAdmin) this.ensurePoster(escrow, userId);
    if (!['UNDER_REVIEW', 'FUNDED_ACTIVE'].includes(escrow.status)) {
      throw new BadRequestException('Escrow cannot be released in current state');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.notifyBoth(updated, 'Escrow released');
    return updated;
  }

  async refund(userId: number, escrowId: string, byAdmin = false) {
    const escrow = await this.getEscrowForAction(userId, escrowId, byAdmin);
    if (!byAdmin) this.ensureNotFrozen(escrow);
    if (!byAdmin) this.ensurePoster(escrow, userId);
    if (!['AWAITING_PAYMENT', 'FUNDED_ACTIVE', 'UNDER_REVIEW'].includes(escrow.status)) {
      throw new BadRequestException('Escrow cannot be refunded in current state');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'REFUNDED', cancelledAt: new Date() },
    });
    await this.notifyBoth(updated, 'Escrow refunded');
    return updated;
  }

  async cancel(userId: number, escrowId: string) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensurePoster(escrow, userId);
    if (!['PROPOSED', 'AWAITING_PAYMENT'].includes(escrow.status)) {
      throw new BadRequestException('Escrow cannot be cancelled in current state');
    }
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.notifyBoth(updated, 'Escrow cancelled');
    return updated;
  }

  async flag(adminId: number, escrowId: string, reason: string) {
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { isFrozen: true, flaggedReason: reason || 'Flagged by admin' },
    });
    await this.notifyBoth(updated, 'Escrow flagged by admin');
    return updated;
  }

  async freeze(adminId: number, escrowId: string) {
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { isFrozen: true },
    });
    await this.notifyBoth(updated, 'Escrow frozen by admin');
    return updated;
  }

  async unfreeze(adminId: number, escrowId: string) {
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { isFrozen: false },
    });
    await this.notifyBoth(updated, 'Escrow unfrozen by admin');
    return updated;
  }

  async extendDeadline(adminId: number, escrowId: string, newDeadline: string) {
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { deadline: new Date(newDeadline) },
    });
    await this.notifyBoth(updated, 'Escrow deadline extended');
    return updated;
  }

  async listForAdmin(status?: string) {
    return this.prisma.escrow.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { ad: true, milestones: true },
    });
  }

  async processExpiredEscrows() {
    const now = new Date();
    const expired = await this.prisma.escrow.findMany({
      where: {
        status: 'FUNDED_ACTIVE',
        noDeadline: false,
        deadline: { not: null, lte: now },
        isFrozen: false,
      },
      select: {
        id: true,
        title: true,
        posterId: true,
        applicantId: true,
        conversationId: true,
      },
    });

    for (const escrow of expired) {
      const updated = await this.prisma.escrow.update({
        where: { id: escrow.id },
        data: { status: 'UNDER_REVIEW' },
      });

      await this.notifications.createNotification({
        userId: escrow.posterId,
        type: 'ESCROW',
        title: 'Escrow deadline elapsed: review required',
        body: 'Escrow period has elapsed. If satisfied, release funds. If not, report issue.',
        data: {
          escrowId: escrow.id,
          conversationId: escrow.conversationId,
          actionRequired: 'POSTER_REVIEW',
        },
      });

      await this.notifications.createNotification({
        userId: escrow.applicantId,
        type: 'ESCROW',
        title: 'Escrow deadline elapsed',
        body: 'Escrow period has elapsed. Awaiting client review decision.',
        data: {
          escrowId: escrow.id,
          conversationId: escrow.conversationId,
          actionRequired: 'WAIT_POSTER_REVIEW',
        },
      });

      this.notifications.emitToUser(escrow.posterId, 'escrow.update', {
        escrowId: escrow.id,
        status: updated.status,
        conversationId: escrow.conversationId,
      });
      this.notifications.emitToUser(escrow.applicantId, 'escrow.update', {
        escrowId: escrow.id,
        status: updated.status,
        conversationId: escrow.conversationId,
      });
    }

    if (expired.length > 0) {
      this.logger.log(`Processed ${expired.length} expired escrow(s) into UNDER_REVIEW state`);
    }

    return expired.length;
  }

  async posterReview(userId: number, escrowId: string, payload: { satisfied: boolean; reason?: string }) {
    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensurePoster(escrow, userId);

    if (!['UNDER_REVIEW', 'FUNDED_ACTIVE'].includes(escrow.status)) {
      throw new BadRequestException('Escrow is not ready for poster review');
    }

    if (payload.satisfied) {
      return this.release(userId, escrowId, false);
    }

    const reason = (payload.reason || '').trim() || 'Client reported dissatisfaction after deadline';
    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: {
        status: 'DISPUTED',
        disputeReason: reason,
      },
    });

    await this.notifications.createNotification({
      userId: escrow.posterId,
      type: 'ESCROW',
      title: 'Dispute opened',
      body: reason,
      data: { escrowId: escrow.id, conversationId: escrow.conversationId },
    });

    await this.notifications.createNotification({
      userId: escrow.applicantId,
      type: 'ESCROW',
      title: 'Client reported an issue',
      body: 'Please explain what happened so admin can review both sides.',
      data: {
        escrowId: escrow.id,
        conversationId: escrow.conversationId,
        actionRequired: 'APPLICANT_EXPLANATION',
      },
    });

    await this.notifyAdmins(
      'Escrow dispute requires review',
      `${escrow.title}: ${reason}`,
      { escrowId: escrow.id, conversationId: escrow.conversationId },
    );

    this.notifications.emitToUser(escrow.posterId, 'escrow.update', {
      escrowId: escrow.id,
      status: updated.status,
      conversationId: escrow.conversationId,
    });
    this.notifications.emitToUser(escrow.applicantId, 'escrow.update', {
      escrowId: escrow.id,
      status: updated.status,
      conversationId: escrow.conversationId,
    });

    return updated;
  }

  async applicantDisputeResponse(userId: number, escrowId: string, explanation: string) {
    const cleanExplanation = (explanation || '').trim();
    if (cleanExplanation.length < 10) {
      throw new BadRequestException('Explanation must be at least 10 characters');
    }

    const escrow = await this.getEscrow(userId, escrowId);
    this.ensureNotFrozen(escrow);
    this.ensureApplicant(escrow, userId);

    if (escrow.status !== 'DISPUTED') {
      throw new BadRequestException('Escrow is not in disputed state');
    }

    const stampedExplanation = `Applicant response (${new Date().toISOString()}): ${cleanExplanation}`;
    const disputeReason = escrow.disputeReason
      ? `${escrow.disputeReason}\n${stampedExplanation}`
      : stampedExplanation;

    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: { disputeReason },
    });

    await this.notifications.createNotification({
      userId: escrow.posterId,
      type: 'ESCROW',
      title: 'Applicant submitted dispute response',
      body: cleanExplanation,
      data: { escrowId: escrow.id, conversationId: escrow.conversationId },
    });

    await this.notifyAdmins(
      'Applicant response received',
      `${escrow.title}: ${cleanExplanation}`,
      { escrowId: escrow.id, conversationId: escrow.conversationId },
    );

    this.notifications.emitToUser(escrow.posterId, 'escrow.update', {
      escrowId: escrow.id,
      status: updated.status,
      conversationId: escrow.conversationId,
    });
    this.notifications.emitToUser(escrow.applicantId, 'escrow.update', {
      escrowId: escrow.id,
      status: updated.status,
      conversationId: escrow.conversationId,
    });

    return updated;
  }

  private async notifyBoth(escrow: any, title: string) {
    await this.notifications.createNotification({
      userId: escrow.posterId,
      type: 'ESCROW',
      title,
      body: escrow.title,
      data: { escrowId: escrow.id, conversationId: escrow.conversationId },
    });
    await this.notifications.createNotification({
      userId: escrow.applicantId,
      type: 'ESCROW',
      title,
      body: escrow.title,
      data: { escrowId: escrow.id, conversationId: escrow.conversationId },
    });
    this.notifications.emitToUser(escrow.posterId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: escrow.conversationId,
    });
    this.notifications.emitToUser(escrow.applicantId, 'escrow.update', {
      escrowId: escrow.id,
      status: escrow.status,
      conversationId: escrow.conversationId,
    });
  }

  private async notifyAdmins(title: string, body: string, data?: any) {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'MODERATOR'] } },
      select: { id: true },
    });

    for (const admin of admins) {
      await this.notifications.createNotification({
        userId: admin.id,
        type: 'ESCROW',
        title,
        body,
        data,
      });
    }
  }
}
