import { QueryClient } from '@tanstack/react-query';

// Single shared QueryClient. Realtime updates (Socket.IO) invalidate queries on
// this client so every open tab re-fetches — see docs/ARCHITECTURE.md §10.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});