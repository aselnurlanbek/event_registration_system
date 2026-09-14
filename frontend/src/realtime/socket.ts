import { io, type Socket } from 'socket.io-client';

// URL of the Socket.IO server (the NestJS backend). Configure via VITE_SOCKET_URL.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5050';

// Lazily-created singleton so the whole app shares one connection.
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ['websocket'],
    });
  }
  return socket;
}

// Room helpers — clients subscribe per event (room "event:{eventId}").
// The gateway that handles these is added in the realtime phase.
export function joinEventRoom(eventId: string): void {
  getSocket().emit('join', { eventId });
}

export function leaveEventRoom(eventId: string): void {
  getSocket().emit('leave', { eventId });
}