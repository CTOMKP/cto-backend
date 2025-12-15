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
    try {
      this.connectedClients++;
      this.logger.log(`✅ Client connected: ${client?.id ?? 'unknown'} (Total: ${this.connectedClients})`);
    } catch (error) {
      this.logger.warn('Error handling WebSocket connection:', error);
    }
  }

  handleDisconnect(client: any) {
    try {
      this.connectedClients--;
      this.logger.log(`❌ Client disconnected: ${client?.id ?? 'unknown'} (Total: ${this.connectedClients})`);
    } catch (error) {
      this.logger.warn('Error handling WebSocket disconnection:', error);
    }
  }

  emitNew(payload: any) {
    try {
      if (this.server && this.connectedClients > 0) {
        this.server.emit('listing.new', payload);
        this.logger.debug(`🆕 Emitted new listing: ${payload.symbol || payload.contractAddress}`);
      }
    } catch (error) {
      this.logger.warn('Failed to emit new listing via WebSocket:', error);
    }
  }

  emitUpdate(payload: any) {
    try {
      if (this.server && this.connectedClients > 0) {
        this.server.emit('listing.update', payload);
        this.logger.debug(`📊 Emitted update: ${payload.symbol || payload.contractAddress} - Price: $${payload.priceUsd}`);
      }
    } catch (error) {
      this.logger.warn('Failed to emit listing update via WebSocket:', error);
    }
  }
}