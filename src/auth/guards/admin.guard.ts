import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const tokenRole = String(user.role || '').toUpperCase();
    if (tokenRole === 'ADMIN' || tokenRole === 'MODERATOR') {
      return true;
    }

    const userId = Number(user.userId || user.sub || 0);
    const email = typeof user.email === 'string' ? user.email : null;

    let dbUser: { role: string } | null = null;

    if (userId > 0) {
      dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
    }

    if (!dbUser && email) {
      dbUser = await this.prisma.user.findUnique({
        where: { email },
        select: { role: true },
      });
    }

    if (dbUser && (dbUser.role === 'ADMIN' || dbUser.role === 'MODERATOR')) {
      request.user = { ...user, role: dbUser.role };
      return true;
    }

    throw new ForbiddenException('Admin or moderator access required');
  }
}
