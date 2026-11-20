import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000, // 1 min smart cache across navigations
            gcTime: 24 * 60 * 60_000, // 24h retention for offline-first hydration
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            networkMode: 'offlineFirst',
            retry: (failureCount, error: any) => {
                if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
                if (!error?.response) return false;
                return failureCount < 1;
            },
        },
        mutations: {
            networkMode: 'offlineFirst',
        },
    },
});
