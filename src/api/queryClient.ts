import { QueryClient } from '@tanstack/react-query';

/** One client for the app; the outbox invalidates through it after a successful send. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnReconnect: true } },
});
