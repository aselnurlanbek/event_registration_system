import { useQuery } from '@tanstack/react-query';
import type { EventDto } from '../types';
import { apiFetch } from './client';

export const eventKeys = {
  all: ['events'] as const,
  detail: (id: string) => ['events', id] as const,
};

export function useEvents() {
  return useQuery({
    queryKey: eventKeys.all,
    queryFn: () => apiFetch<EventDto[]>('/events'),
  });
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: eventKeys.detail(eventId),
    queryFn: () => apiFetch<EventDto>(`/events/${eventId}`),
    enabled: !!eventId,
  });
}