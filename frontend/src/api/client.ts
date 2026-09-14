// Base URL of the backend REST API. Configure via VITE_API_URL; defaults to the
// NestJS dev server (see backend/.env.example — PORT=5050, global prefix /api).
export const API_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:5050/api';

// Error carrying the HTTP status so callers can map responses (e.g. 404 vs 409).
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// --- auth wiring (set by AuthContext) ------------------------------------
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Thin fetch wrapper. Attaches the JWT (when set), parses JSON, and throws
 * ApiError on non-2xx. If an *authenticated* request comes back 401 (expired /
 * invalid token), the registered unauthorized handler is invoked so the app can
 * clear session state gracefully.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    // Only treat 401 as a session problem when we actually sent a token — a
    // failed login (no token) must not trigger a global logout.
    if (res.status === 401 && authToken) {
      onUnauthorized?.();
    }
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // response had no JSON body — keep the default message
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}