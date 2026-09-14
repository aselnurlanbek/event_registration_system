import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api/client';

interface HealthResponse {
  status: string;
  uptime: number;
}

/**
 * Phase 0 placeholder. Verifies the TypeScript + TanStack Query wiring by
 * pinging the backend health endpoint. Real pages (event list, register,
 * ticket, check-in, dashboard) are built in later phases.
 */
function App() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Event Registration System</h1>
      <p>Frontend scaffold ready (React + TypeScript + Vite + TanStack Query).</p>

      <h2>Backend status</h2>
      {isLoading && <p>Checking…</p>}
      {isError && (
        <p style={{ color: 'crimson' }}>
          Backend unreachable: {(error as Error).message}
        </p>
      )}
      {data && (
        <p style={{ color: 'green' }}>
          {data.status} — uptime {data.uptime.toFixed(1)}s
        </p>
      )}
    </main>
  );
}

export default App;