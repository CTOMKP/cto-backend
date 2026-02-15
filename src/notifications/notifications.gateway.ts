import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(socket: Socket) {
    this.logger.log(`✅ Notifications WS connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket) {
    this.logger.log(`❌ Notifications WS disconnected: ${socket.id}`);
  }

  @SubscribeMessage('notifications.subscribe')
  async handleSubscribe(
    @MessageBody() payload: { token?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const token = payload?.token;
    if (!token) {
      this.logger.warn('notifications.subscribe missing token');
      return;
    }

    try {
      const decoded: any = this.jwtService.verify(token);
      const userId = decoded?.sub || decoded?.userId;
      if (!userId) {
        this.logger.warn('notifications.subscribe invalid token payload');
        return;
      }

      const room = this.buildUserRoom(Number(userId));
      socket.join(room);
      socket.emit('notifications.subscribed', { userId });
    } catch (error: any) {
      this.logger.warn(`notifications.subscribe failed: ${error.message}`);
      socket.emit('notifications.error', { message: 'Invalid token' });
    }
  }

  emitToUser(userId: number, event: string, payload: any) {
    const room = this.buildUserRoom(userId);
    this.server.to(room).emit(event, payload);
  }

  private buildUserRoom(userId: number) {
    return `user:${userId}`;
  }
}
