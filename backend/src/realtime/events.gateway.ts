import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EventStats } from '../dashboard/dashboard.service';

/** Room naming convention: one room per event. */
export function eventRoom(eventId: string): string {
  return `event:${eventId}`;
}

export interface StatsUpdatedPayload extends EventStats {
  eventId: string;
}

// CORS `origin: true` reflects the request origin (dev-friendly). No auth in
// scope for this assignment.
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class EventsGateway {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  /** Client subscribes to an event's live stats. */
  @SubscribeMessage('subscribe')
  subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    const room = eventRoom(data.eventId);
    void client.join(room);
    this.logger.debug(`${client.id} subscribed to ${room}`);
    // Plain object → sent as an ack. (A `{ event, data }` shape would instead be
    // treated as a WsResponse and emitted, so no ack would reach the client.)
    return { status: 'subscribed', eventId: data.eventId };
  }

  /** Client unsubscribes from an event's live stats. */
  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    const room = eventRoom(data.eventId);
    void client.leave(room);
    this.logger.debug(`${client.id} unsubscribed from ${room}`);
    return { status: 'unsubscribed', eventId: data.eventId };
  }

  /**
   * Broadcast a stats snapshot to every client subscribed to the event.
   * The payload contains only aggregate counts — no participant PII (req. 5).
   */
  emitStatsUpdated(eventId: string, stats: EventStats): void {
    const payload: StatsUpdatedPayload = { eventId, ...stats };
    this.server.to(eventRoom(eventId)).emit('event.stats.updated', payload);
  }
}