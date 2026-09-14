import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { RegistrationStatus } from '../types';
import { apiFetch } from './client';
import { eventKeys } from './events';
import { myRegistrationsKey } from './me';

export interface ParticipantDto {
  id: string;
  email: string;
  status: RegistrationStatus;
  waitlistPos: number | null;
  checkedInAt: string | null;
  createdAt: string;
  ticket: { code: string } | null;
}

export interface EventRegistrations {
  eventId: string;
  counts: { registered: number; waitlisted: number };
  registered: ParticipantDto[];
  waitlisted: ParticipantDto[];
}

export const registrationsKey = (eventId: string) =>
  ['events', eventId, 'registrations'] as const;

export function useEventRegistrations(eventId: string) {
  return useQuery({
    queryKey: registrationsKey(eventId),
    queryFn: () =>
      apiFetch<EventRegistrations>(`/events/${eventId}/registrations`),
    enabled: !!eventId,
  });
}

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

export interface CancelResult {
  registration: { id: string; status: RegistrationStatus };
  cancelled: boolean;
  alreadyCancelled: boolean;
  promoted: { email: string } | null;
}

// After a registration/cancellation, refresh everything that depends on it so
// the UI reflects backend state (req. 6, 7).
function invalidateAfterRegChange(qc: QueryClient, eventId: string) {
  void qc.invalidateQueries({ queryKey: myRegistrationsKey });
  void qc.invalidateQueries({ queryKey: eventKeys.all });
  void qc.invalidateQueries({ queryKey: eventKeys.detail(eventId) });
  void qc.invalidateQueries({ queryKey: registrationsKey(eventId) });
  void qc.invalidateQueries({ queryKey: ['events', eventId, 'stats'] });
}

/**
 * Register the authenticated participant. Identity comes from the JWT on the
 * backend — no email is sent. The backend decides REGISTERED vs WAITLISTED and
 * is idempotent for duplicates; the UI only reflects that response.
 */
export function useRegister(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RegistrationResult>(`/events/${eventId}/registrations`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAfterRegChange(qc, eventId),
  });
}

/** Cancel the authenticated participant's own registration for an event. */
export function useCancelRegistration(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<CancelResult>(`/events/${eventId}/registrations/cancel`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAfterRegChange(qc, eventId),
  });
}