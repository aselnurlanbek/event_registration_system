import { Navigate, Outlet } from 'react-router-dom';
import type { AccountRole } from '../api/auth';
import { roleHome, useAuth } from './context';

// Protects a route subtree. Unauthenticated → /login; wrong role → own home.
export function RequireRole({ role }: { role: AccountRole }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={roleHome(user.role)} replace />;
  return <Outlet />;
}