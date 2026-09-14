import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchMe,
  loginRequest,
  registerRequest,
  type AccountRole,
  type AuthResponse,
  type PublicUser,
} from '../api/auth';
import { setAuthToken, setUnauthorizedHandler } from '../api/client';
import { AuthContext } from './context';

const STORAGE_KEY = 'auth';

interface StoredAuth {
  user: PublicUser;
  token: string;
}

function readStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = readStored();
  const [user, setUser] = useState<PublicUser | null>(initial?.user ?? null);
  const [token, setToken] = useState<string | null>(initial?.token ?? null);

  // Make the initial token available to apiFetch immediately.
  if (initial?.token) setAuthToken(initial.token);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const persist = useCallback((res: AuthResponse) => {
    setUser(res.user);
    setToken(res.accessToken);
    setAuthToken(res.accessToken);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: res.user, token: res.accessToken }),
    );
    return res.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      persist(await loginRequest(email, password)),
    [persist],
  );

  const register = useCallback(
    async (email: string, password: string, role: AccountRole) =>
      persist(await registerRequest(email, password, role)),
    [persist],
  );

  // Clear session on any 401 from an authenticated request (expired/invalid).
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // On load, if we have a token, verify it and refresh the user. A bad token
  // triggers the unauthorized handler above → clean logout.
  useEffect(() => {
    if (!initial?.token) return;
    fetchMe()
      .then((fresh) => {
        setUser(fresh);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ user: fresh, token: initial.token }),
        );
      })
      .catch(() => {
        /* handled by the unauthorized handler; ignore network errors */
      });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ user, token, login, register, logout }),
    [user, token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}