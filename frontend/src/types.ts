// Shared DTO types, mirroring the backend responses.

export type RegistrationStatus = 'REGISTERED' | 'WAITLISTED' | 'CANCELLED';

export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  startsAt: string; // ISO-8601 (UTC)
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventStats {
  capacity: number;
  registered: number;
  waitlisted: number;
  checkedIn: number;
}

// Payload of the `event.stats.updated` WebSocket event.
export interface StatsUpdatedPayload extends EventStats {
  eventId: string;
}