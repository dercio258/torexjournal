export type PollPaymentMethod =
    | 'mpesa'
    | 'emola'
    | 'card'
    | 'payfast'
    | 'pix'
    | 'crypto'
    | string;

export interface AdaptivePollDelayParams {
    attempt: number;
    method?: PollPaymentMethod | null;
    elapsedMs?: number;
    serverNextPollAfterMs?: number | null;
    retryAfterMs?: number | null;
    previousDelayMs?: number | null;
}

export interface CallbackFailureDetection {
    isFailed: boolean;
    statusCode: string;
    reason: string;
}

const MIN_POLL_DELAY_MS = 2500;
const MAX_POLL_DELAY_MS = 30000;

export function clampPollDelay(ms: number): number {
    if (!Number.isFinite(ms)) return 5000;
    return Math.min(MAX_POLL_DELAY_MS, Math.max(MIN_POLL_DELAY_MS, Math.round(ms)));
}

/**
 * Computes demand-aware polling delay:
 * - Honors 429 Retry-After / exponential rate-limit backoff first.
 * - Honors backend `nextPollAfterMs` hints when present (`0` means stop).
 * - Otherwise uses elapsed time / attempt count with method-appropriate tiers.
 */
export function computeAdaptivePollDelay(params: AdaptivePollDelayParams): number {
    if (params.retryAfterMs !== undefined && params.retryAfterMs !== null && params.retryAfterMs > 0) {
        const doubledPrev = params.previousDelayMs ? params.previousDelayMs * 2 : 0;
        return clampPollDelay(Math.max(params.retryAfterMs, doubledPrev));
    }

    if (
        params.serverNextPollAfterMs !== undefined &&
        params.serverNextPollAfterMs !== null &&
        Number.isFinite(params.serverNextPollAfterMs)
    ) {
        if (params.serverNextPollAfterMs <= 0) return 0;
        return clampPollDelay(params.serverNextPollAfterMs);
    }

    const elapsedMs = Math.max(
        0,
        params.elapsedMs ?? Math.max(0, params.attempt) * 4000,
    );
    const m = String(params.method || '').trim().toLowerCase();

    if (m === 'mpesa' || m === 'emola') {
        if (elapsedMs < 45_000) return 3500;
        if (elapsedMs < 120_000) return 5500;
        return 9000;
    }
    if (m === 'card' || m === 'payfast') {
        if (elapsedMs < 30_000) return 3000;
        if (elapsedMs < 120_000) return 6000;
        return 10000;
    }
    if (m === 'pix') {
        if (elapsedMs < 45_000) return 4000;
        if (elapsedMs < 180_000) return 8000;
        return 12000;
    }
    if (m === 'crypto') {
        if (elapsedMs < 60_000) return 6000;
        if (elapsedMs < 300_000) return 10000;
        return 15000;
    }

    if (elapsedMs < 45_000) return 4000;
    if (elapsedMs < 180_000) return 7500;
    return 12000;
}

/**
 * Extracts rate-limit backoff delay (in ms) from an HTTP 429 Axios error.
 */
export function parseRetryAfterHeader(error: any): number | null {
    const status = error?.response?.status;
    if (status !== 429) return null;

    const headers = error?.response?.headers || {};
    const rawHeader =
        headers['retry-after'] ??
        headers['Retry-After'] ??
        error?.response?.data?.retryAfterMs;

    if (rawHeader !== undefined && rawHeader !== null) {
        const numeric = Number(rawHeader);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric < 1000 ? numeric * 1000 : numeric;
        }
        const dateMs = Date.parse(String(rawHeader));
        if (Number.isFinite(dateMs)) {
            const diff = dateMs - Date.now();
            if (diff > 0) return diff;
        }
    }

    return 10_000;
}

const FAILURE_QUERY_VALUES = new Set([
    'failed',
    'fail',
    'cancelled',
    'canceled',
    'expired',
    'error',
    'declined',
    'rejected',
    'timeout',
]);

export function detectCallbackFailureFromSearch(
    searchParams: URLSearchParams,
): CallbackFailureDetection {
    const candidates = [
        searchParams.get('payment_status'),
        searchParams.get('payment_callback'),
        searchParams.get('status'),
    ];
    const cancelledFlag = String(
        searchParams.get('cancelled') || searchParams.get('canceled') || '',
    )
        .trim()
        .toLowerCase();

    const reason = String(
        searchParams.get('payment_reason') ||
            searchParams.get('reason') ||
            searchParams.get('error') ||
            searchParams.get('message') ||
            '',
    ).trim();

    if (cancelledFlag === '1' || cancelledFlag === 'true') {
        return { isFailed: true, statusCode: 'cancelled', reason: reason || 'cancelled' };
    }

    for (const raw of candidates) {
        const norm = String(raw || '').trim().toLowerCase();
        if (norm && FAILURE_QUERY_VALUES.has(norm)) {
            return { isFailed: true, statusCode: norm, reason: reason || norm };
        }
    }

    if (searchParams.get('error')) {
        return { isFailed: true, statusCode: 'error', reason: reason || 'failed' };
    }

    return { isFailed: false, statusCode: '', reason };
}

export function buildCheckoutFailureUrl(params: {
    localizePath?: (path: string) => string;
    subscriptionId?: string;
    method?: string;
    tier?: string;
    cycle?: string;
    reason?: string;
}): string {
    const basePath = params.localizePath ? params.localizePath('/checkout') : '/checkout';
    const qs = new URLSearchParams();
    qs.set('payment_status', 'failed');
    if (params.subscriptionId) qs.set('subscription_id', params.subscriptionId);
    if (params.method) qs.set('method', params.method);
    if (params.tier) qs.set('tier', params.tier);
    if (params.cycle) qs.set('cycle', params.cycle);
    if (params.reason) qs.set('payment_reason', params.reason.slice(0, 220));
    const sep = basePath.includes('?') ? '&' : '?';
    return `${basePath}${sep}${qs.toString()}`;
}

export function resolvePaymentFailureCopy(
    reason?: string | null,
    isEn = false,
): { title: string; message: string } {
    const clean = String(reason || '').trim();
    const lower = clean.toLowerCase();

    if (lower === 'expired' || lower === 'timeout') {
        return isEn
            ? {
                  title: 'Payment Expired',
                  message:
                      'The payment window expired before confirmation. No charge was activated—please try again.',
              }
            : {
                  title: 'Pagamento Expirado',
                  message:
                      'O tempo limite do pagamento expirou antes da confirmação. Nenhum plano foi ativado—tente novamente.',
              };
    }

    if (lower === 'cancelled' || lower === 'canceled') {
        return isEn
            ? {
                  title: 'Payment Cancelled',
                  message:
                      'Your payment was cancelled before completion. You can retry with this method or select another option.',
              }
            : {
                  title: 'Pagamento Cancelado',
                  message:
                      'O pagamento foi cancelado antes da conclusão. Você pode tentar novamente ou escolher outro método.',
              };
    }

    if (lower === 'missing_reference') {
        return isEn
            ? {
                  title: 'Payment Not Confirmed',
                  message:
                      'We could not identify a confirmed payment for this return. Please retry your checkout.',
              }
            : {
                  title: 'Pagamento Não Confirmado',
                  message:
                      'Não foi possível confirmar uma transação válida neste retorno. Tente realizar o pagamento novamente.',
              };
    }

    if (
        clean &&
        !['failed', 'error', 'declined', 'rejected'].includes(lower) &&
        clean.length <= 220
    ) {
        return {
            title: isEn ? 'Payment Unsuccessful' : 'Pagamento Não Sucedido',
            message: clean,
        };
    }

    return isEn
        ? {
              title: 'Payment Unsuccessful',
              message:
                  'Your payment could not be completed or was declined by the provider. Please try again or pick another payment method.',
          }
        : {
              title: 'Pagamento Não Sucedido',
              message:
                  'O pagamento não foi concluído ou foi recusado pela operadora. Tente novamente ou escolha outro método de pagamento.',
          };
}
