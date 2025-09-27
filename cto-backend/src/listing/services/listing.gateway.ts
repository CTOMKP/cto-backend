import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class ListingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ListingGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    this.logger.log(`Client connected: ${client?.id ?? 'unknown'}`);
  }

  handleDisconnect(client: any) {
    this.logger.log(`Client disconnected: ${client?.id ?? 'unknown'}`);
  }

  emitNew(payload: any) {
    this.server.emit('listing.new', payload);
  }

  emitUpdate(payload: any) {
    this.server.emit('listing.update', payload);
  }
}