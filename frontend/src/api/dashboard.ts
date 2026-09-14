import { useQuery } from '@tanstack/react-query';
import type { EventStats } from '../types';
import { apiFetch } from './client';

export const statsKey = (eventId: string) =>
  ['events', eventId, 'stats'] as const;

export function useEventStats(eventId: string) {
  return useQuery({
    queryKey: statsKey(eventId),
    queryFn: () => apiFetch<EventStats>(`/events/${eventId}/stats`),
    enabled: !!eventId,
  });
}