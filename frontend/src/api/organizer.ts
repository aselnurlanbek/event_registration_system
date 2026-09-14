import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventDto } from '../types';
import { apiFetch } from './client';
import { eventKeys } from './events';

export const organizerEventsKey = ['organizer', 'events'] as const;

export interface EventInput {
  title: string;
  description?: string;
  startsAt: string; // ISO-8601
  capacity: number;
}

export interface CancelEventResult {
  eventId: string;
  status: 'CANCELLED';
  alreadyCancelled: boolean;
  notified: number;
}

export function useMyEvents() {
  return useQuery({
    queryKey: organizerEventsKey,
    queryFn: () => apiFetch<EventDto[]>('/organizer/events'),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, eventId?: string) {
  void qc.invalidateQueries({ queryKey: organizerEventsKey });
  void qc.invalidateQueries({ queryKey: eventKeys.all });
  if (eventId) void qc.invalidateQueries({ queryKey: eventKeys.detail(eventId) });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInput) =>
      apiFetch<EventDto>('/events', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateEvent(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<EventInput>) =>
      apiFetch<EventDto>(`/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      apiFetch<CancelEventResult>(`/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: (_res, eventId) => invalidate(qc, eventId),
  });
}