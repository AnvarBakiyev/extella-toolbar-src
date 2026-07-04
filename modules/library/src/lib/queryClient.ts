import { QueryClient } from '@tanstack/react-query';

/**
 * Single shared TanStack Query client.
 *
 * - `staleTime: 30s` — UI lists are paginated server-side; staleness is fine
 *   between micro-navigations and avoids hammering the upstream cache.
 * - `retry: 1` — one retry on transient failures; we have toast handling for
 *   429/5xx in the axios interceptor already, retrying further is noise.
 * - `refetchOnWindowFocus: false` — admin work is bursty; refocus refetch
 *   is jarring during multi-window flows.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
