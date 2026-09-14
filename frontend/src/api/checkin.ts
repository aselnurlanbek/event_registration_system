import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface CheckInResult {
  ticketCode: string;
  status: 'CHECKED_IN';
  checkedInAt: string;
  participant: { id: string; email: string };
}

export function useCheckIn(eventId: string) {
  return useMutation({
    mutationFn: (ticketCode: string) =>
      apiFetch<CheckInResult>(`/events/${eventId}/check-in`, {
        method: 'POST',
        body: JSON.stringify({ ticketCode }),
      }),
  });
}