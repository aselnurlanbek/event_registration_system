import { useMutation } from '@tanstack/react-query';
import type { RegistrationStatus } from '../types';
import { apiFetch } from './client';

export interface RegistrationResult {
  id: string;
  eventId: string;
  email: string;
  status: RegistrationStatus;
  waitlistPos: number | null;
  checkedInAt: string | null;
  ticket: { code: string } | null;
  createdAt: string;
}

/**
 * Register a participant. The backend decides REGISTERED vs WAITLISTED and is
 * idempotent for duplicates (returns the existing registration) — the UI only
 * reflects that response, it never reproduces capacity logic.
 */
export function useRegister(eventId: string) {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<RegistrationResult>(`/events/${eventId}/registrations`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
  });
}