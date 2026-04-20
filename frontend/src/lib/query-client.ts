import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes — data considered fresh
      gcTime: 10 * 60 * 1000,   // 10 minutes — cache retention after unmount
      retry: 2,                   // Survive Railway cold starts
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});
