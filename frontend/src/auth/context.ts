import { createContext, useContext } from 'react';
import type { AccountRole, PublicUser } from '../api/auth';

export function roleHome(role: AccountRole): string {
  return role === 'ORGANIZER' ? '/organizer' : '/participant';
}

export interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (
    email: string,
    password: string,
    role: AccountRole,
  ) => Promise<PublicUser>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}