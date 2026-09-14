import { useQuery } from '@tanstack/react-query';
import type { RegistrationStatus } from '../types';
import { apiFetch } from './client';

export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  waitlistPos: number | null;
  checkedInAt: string | null;
  createdAt: string;
  ticketCode: string | null;
  event: {
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    capacity: number;
    status: 'ACTIVE' | 'CANCELLED';
  };
}

export const myRegistrationsKey = ['me', 'registrations'] as const;

export function useMyRegistrations() {
  return useQuery({
    queryKey: myRegistrationsKey,
    queryFn: () => apiFetch<MyRegistration[]>('/me/registrations'),
  });
}