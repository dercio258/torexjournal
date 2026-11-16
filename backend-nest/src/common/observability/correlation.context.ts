import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface RequestCorrelationStore {
    correlationId: string;
    userId?: string;
    method?: string;
    path?: string;
    startedAt?: number;
}

export const correlationStorage = new AsyncLocalStorage<RequestCorrelationStore>();

export function getCorrelationId(): string | undefined {
    return correlationStorage.getStore()?.correlationId;
}

export function getCorrelationStore(): RequestCorrelationStore | undefined {
    return correlationStorage.getStore();
}

export function runWithCorrelation<T>(
    partial: Partial<RequestCorrelationStore>,
    fn: () => T,
): T {
    const store: RequestCorrelationStore = {
        correlationId: partial.correlationId || randomUUID(),
        userId: partial.userId,
        method: partial.method,
        path: partial.path,
        startedAt: partial.startedAt ?? Date.now(),
    };
    return correlationStorage.run(store, fn);
}
