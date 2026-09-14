import { apiFetch } from './client';

export type AccountRole = 'PARTICIPANT' | 'ORGANIZER';

export interface PublicUser {
  id: string;
  email: string;
  role: AccountRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

export function loginRequest(email: string, password: string) {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function registerRequest(
  email: string,
  password: string,
  role: AccountRole,
) {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, role }),
  });
}

export function fetchMe() {
  return apiFetch<PublicUser>('/auth/me');
}