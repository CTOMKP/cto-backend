import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class ListingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ListingGateway.name);
  private connectedClients = 0;

  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    this.connectedClients++;
    this.logger.log(`✅ Client connected: ${client?.id ?? 'unknown'} (Total: ${this.connectedClients})`);
  }

  handleDisconnect(client: any) {
    this.connectedClients--;
    this.logger.log(`❌ Client disconnected: ${client?.id ?? 'unknown'} (Total: ${this.connectedClients})`);
  }

  emitNew(payload: any) {
    if (this.connectedClients > 0) {
      this.server.emit('listing.new', payload);
      this.logger.debug(`🆕 Emitted new listing: ${payload.symbol || payload.contractAddress}`);
    }
  }

  emitUpdate(payload: any) {
    if (this.connectedClients > 0) {
      this.server.emit('listing.update', payload);
      this.logger.debug(`📊 Emitted update: ${payload.symbol || payload.contractAddress} - Price: $${payload.priceUsd}`);
    }
  }
}