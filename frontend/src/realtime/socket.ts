import { io, type Socket } from 'socket.io-client';
import type { StatsUpdatedPayload } from '../types';

// URL of the Socket.IO server (the NestJS backend). Configure via VITE_SOCKET_URL.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5050';

// Lazily-created singleton so the whole app shares one connection.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: true, transports: ['websocket'] });
  }
  return socket;
}

// Room subscription — clients subscribe per event (room "event:{eventId}").
// These match the backend gateway's `subscribe`/`unsubscribe` messages.
export function subscribeToEvent(eventId: string): void {
  getSocket().emit('subscribe', { eventId });
}

export function unsubscribeFromEvent(eventId: string): void {
  getSocket().emit('unsubscribe', { eventId });
}

/**
 * Listen for live stats updates. Returns an unsubscribe function.
 * This is realtime *infrastructure*; wiring it into the dashboard UI happens in
 * a later phase.
 */
export function onStatsUpdated(
  handler: (payload: StatsUpdatedPayload) => void,
): () => void {
  const s = getSocket();
  s.on('event.stats.updated', handler);
  return () => s.off('event.stats.updated', handler);
}