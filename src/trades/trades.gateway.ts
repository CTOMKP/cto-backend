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
import { TradeHistoryService } from './trade-history.service';

interface TradeSubscribePayload {
  tokenAddress: string;
  chain?: string;
  limit?: number;
}

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class TradesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TradesGateway.name);
  private readonly roomState = new Map<
    string,
    { interval: NodeJS.Timeout; subscribers: number; tokenAddress: string; chain: string; limit: number; lastSignature?: string }
  >();
  private readonly socketRooms = new Map<string, Set<string>>();
  private readonly pollIntervalMs = 2_000;

  @WebSocketServer()
  server!: Server;

  constructor(private readonly tradeHistoryService: TradeHistoryService) {}

  handleConnection(socket: Socket) {
    this.logger.log(`✅ Trades WS connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket) {
    this.logger.log(`❌ Trades WS disconnected: ${socket.id}`);
    const rooms = this.socketRooms.get(socket.id);
    if (rooms) {
      rooms.forEach((roomKey) => this.removeSubscriber(roomKey));
      this.socketRooms.delete(socket.id);
    }
  }

  @SubscribeMessage('trades.subscribe')
  async handleSubscribe(
    @MessageBody() payload: TradeSubscribePayload,
    @ConnectedSocket() socket: Socket,
  ) {
    const tokenAddress = payload?.tokenAddress;
    if (!tokenAddress) {
      this.logger.warn('trades.subscribe missing tokenAddress');
      return;
    }

    const chain = this.normalizeChain(payload?.chain);
    const limit = Math.min(Math.max(Number(payload?.limit) || 50, 1), 200);
    const roomKey = this.buildRoomKey(chain, tokenAddress);

    socket.join(roomKey);
    this.addSocketRoom(socket.id, roomKey);

    const existing = this.roomState.get(roomKey);
    if (existing) {
      existing.subscribers += 1;
      return;
    }

    await this.emitTrades(roomKey, tokenAddress, chain, limit);

    const interval = setInterval(async () => {
      await this.emitTrades(roomKey, tokenAddress, chain, limit);
    }, this.pollIntervalMs);

    this.roomState.set(roomKey, {
      interval,
      subscribers: 1,
      tokenAddress,
      chain,
      limit,
    });
  }

  @SubscribeMessage('trades.unsubscribe')
  async handleUnsubscribe(
    @MessageBody() payload: TradeSubscribePayload,
    @ConnectedSocket() socket: Socket,
  ) {
    const tokenAddress = payload?.tokenAddress;
    if (!tokenAddress) {
      return;
    }

    const chain = this.normalizeChain(payload?.chain);
    const roomKey = this.buildRoomKey(chain, tokenAddress);
    socket.leave(roomKey);
    this.removeSocketRoom(socket.id, roomKey);
    this.removeSubscriber(roomKey);
  }

  private async emitTrades(
    roomKey: string,
    tokenAddress: string,
    chain: string,
    limit: number,
  ) {
    try {
      const trades = await this.tradeHistoryService.getTrades(tokenAddress, limit, chain, false);
      const signature = trades
        .slice(0, 10)
        .map((t) => t.txHash || t.timestamp || '')
        .join('|');
      const state = this.roomState.get(roomKey);
      if (state?.lastSignature === signature) {
        return;
      }
      if (state) {
        state.lastSignature = signature;
      }
      this.server.to(roomKey).emit('trades.update', {
        tokenAddress,
        chain,
        trades,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      this.logger.warn(`Failed to emit trades for ${tokenAddress} (${chain}): ${error.message}`);
      this.server.to(roomKey).emit('trades.error', {
        tokenAddress,
        chain,
        message: error.message || 'Failed to fetch trades',
      });
    }
  }

  private buildRoomKey(chain: string, tokenAddress: string) {
    const address = this.normalizeAddress(tokenAddress);
    return `trades:${chain}:${address}`;
  }

  private normalizeAddress(address: string) {
    if (address?.startsWith('0x')) return address.toLowerCase();
    return address;
  }

  private normalizeChain(chain?: string) {
    const raw = (chain || '').toLowerCase();
    if (raw === 'eth') return 'ethereum';
    if (raw === 'bnb') return 'bsc';
    return raw || 'solana';
  }

  private addSocketRoom(socketId: string, roomKey: string) {
    const rooms = this.socketRooms.get(socketId) || new Set<string>();
    rooms.add(roomKey);
    this.socketRooms.set(socketId, rooms);
  }

  private removeSocketRoom(socketId: string, roomKey: string) {
    const rooms = this.socketRooms.get(socketId);
    if (!rooms) return;
    rooms.delete(roomKey);
    if (rooms.size === 0) {
      this.socketRooms.delete(socketId);
    }
  }

  private removeSubscriber(roomKey: string) {
    const existing = this.roomState.get(roomKey);
    if (!existing) return;
    existing.subscribers -= 1;
    if (existing.subscribers <= 0) {
      clearInterval(existing.interval);
      this.roomState.delete(roomKey);
    }
  }
}
