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

/**
 * Thin fetch wrapper. Parses JSON, throws on non-2xx responses so TanStack
 * Query can surface errors. Domain-specific hooks are added in later phases.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
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