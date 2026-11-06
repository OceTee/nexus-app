import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../infra/apiClient';

/**
 * TanStack Query only for network-only resources (TDD Section G, Server-state
 * management): cached data renders offline and queries pause instead of failing.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 60_000,
      retry: (count, err) =>
        count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

export const qk = {
  me: () => ['me'] as const,
  usage: () => ['me', 'usage'] as const,
  devices: () => ['devices'] as const,
  syncStatus: () => ['sync', 'status'] as const,
  meta: () => ['meta'] as const,
};
