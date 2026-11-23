import { useEffect, useRef } from 'react';
import {
    computeAdaptivePollDelay,
    parseRetryAfterHeader,
    PollPaymentMethod,
} from '../lib/paymentPolling';

export interface AdaptivePollStepResult {
    settled: boolean;
    nextPollAfterMs?: number | null;
}

export interface UseAdaptivePaymentPollingOptions {
    enabled: boolean;
    method?: PollPaymentMethod | null;
    maxDurationMs?: number;
    initialDelayMs?: number;
    onPoll: () => Promise<AdaptivePollStepResult>;
    onTimeout?: () => void;
}

/**
 * Demand-aware adaptive polling hook:
 * - Single-flight (never sends overlapping requests).
 * - Adapts interval from backend `nextPollAfterMs` or elapsed/method backoff.
 * - Pauses when tab is hidden and triggers immediate check on focus/visibility restore.
 * - Applies Retry-After backoff on HTTP 429.
 */
export function useAdaptivePaymentPolling({
    enabled,
    method,
    maxDurationMs = 15 * 60 * 1000,
    initialDelayMs,
    onPoll,
    onTimeout,
}: UseAdaptivePaymentPollingOptions): void {
    const onPollRef = useRef(onPoll);
    const onTimeoutRef = useRef(onTimeout);
    onPollRef.current = onPoll;
    onTimeoutRef.current = onTimeout;

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        let timerId: number | null = null;
        let inFlight = false;
        let attempt = 0;
        let lastDelayMs = initialDelayMs ?? computeAdaptivePollDelay({ attempt: 0, method });
        const startedAt = Date.now();

        const clearTimer = () => {
            if (timerId !== null) {
                window.clearTimeout(timerId);
                timerId = null;
            }
        };

        const scheduleNext = (delayMs: number) => {
            clearTimer();
            if (cancelled || delayMs <= 0) return;
            lastDelayMs = delayMs;
            timerId = window.setTimeout(() => {
                void runCheck();
            }, delayMs);
        };

        const runCheck = async () => {
            if (cancelled || inFlight) return;

            const elapsedMs = Date.now() - startedAt;
            if (maxDurationMs > 0 && elapsedMs >= maxDurationMs) {
                onTimeoutRef.current?.();
                return;
            }

            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }

            inFlight = true;
            const currentAttempt = attempt;
            attempt += 1;

            try {
                const outcome = await onPollRef.current();
                if (cancelled || outcome?.settled) {
                    return;
                }

                const elapsedAfter = Date.now() - startedAt;
                if (maxDurationMs > 0 && elapsedAfter >= maxDurationMs) {
                    onTimeoutRef.current?.();
                    return;
                }

                const nextDelay = computeAdaptivePollDelay({
                    attempt: currentAttempt + 1,
                    method,
                    elapsedMs: elapsedAfter,
                    serverNextPollAfterMs: outcome?.nextPollAfterMs,
                    previousDelayMs: lastDelayMs,
                });
                scheduleNext(nextDelay);
            } catch (err: any) {
                if (cancelled) return;
                const retryAfterMs = parseRetryAfterHeader(err);
                const elapsedAfter = Date.now() - startedAt;
                const nextDelay = computeAdaptivePollDelay({
                    attempt: currentAttempt + 1,
                    method,
                    elapsedMs: elapsedAfter,
                    retryAfterMs: retryAfterMs ?? Math.min(20_000, Math.round(lastDelayMs * 1.5)),
                    previousDelayMs: lastDelayMs,
                });
                scheduleNext(nextDelay);
            } finally {
                inFlight = false;
            }
        };

        const handleVisibilityOrFocus = () => {
            if (cancelled) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                clearTimer();
                return;
            }
            if (!inFlight) {
                clearTimer();
                void runCheck();
            }
        };

        const firstDelay =
            initialDelayMs !== undefined
                ? initialDelayMs
                : computeAdaptivePollDelay({ attempt: 0, method, elapsedMs: 0 });

        if (firstDelay <= 0) {
            void runCheck();
        } else {
            scheduleNext(firstDelay);
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', handleVisibilityOrFocus);
        }

        return () => {
            cancelled = true;
            clearTimer();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', handleVisibilityOrFocus);
            }
        };
    }, [enabled, method, maxDurationMs, initialDelayMs]);
}
