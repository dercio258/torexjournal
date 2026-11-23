/** Shared helpers for translating auth API failures into UI state. */

interface ApiErrorLike {
    response?: {
        status?: number;
        headers?: Record<string, string | undefined>;
        data?: { message?: string; error?: string; errorRef?: string; supportEmail?: string };
    };
}

export const SUPPORT_EMAIL = 'info@torexjournal.com';

export const getErrorRef = (err: unknown): string | null => {
    const resp = (err as ApiErrorLike)?.response;
    const fromBody = resp?.data?.errorRef;
    if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
    const fromHeader = resp?.headers?.['x-error-ref'];
    if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
    return null;
};

export const getApiMessage = (err: unknown, fallback: string): string => {
    const data = (err as ApiErrorLike)?.response?.data;
    const ref = getErrorRef(err);
    const rawMsg = data?.message || data?.error || '';
    if (rawMsg) {
        if (ref && !rawMsg.includes(ref) && (err as ApiErrorLike)?.response?.status && ((err as ApiErrorLike)?.response?.status ?? 0) >= 500) {
            return `${rawMsg} (Ref.: ${ref})`;
        }
        return rawMsg;
    }
    return ref ? `${fallback} (Ref.: ${ref})` : fallback;
};

export const isRateLimited = (err: unknown) => (err as ApiErrorLike)?.response?.status === 429;

/**
 * Seconds to wait after a 429, parsed from the backend message
 * ("... 15 segundos", "... por 5 minutos", "5 minutes"); `fallback` otherwise.
 */
export const parseRetryAfter = (message: string, fallback = 60): number => {
    const seconds = message.match(/(\d+)\s*(segundos?|seconds?)/i);
    if (seconds) return parseInt(seconds[1], 10);
    const minutes = message.match(/(\d+)\s*(minutos?|minutes?)/i);
    if (minutes) return parseInt(minutes[1], 10) * 60;
    return fallback;
};

/** Friendly messages for known registration errors in PT or EN. */
export const getRegisterErrorMessage = (original: string, locale: 'pt' | 'en' = 'pt'): string => {
    const err = original?.toLowerCase() || '';
    const isDirectPolicyMessage =
        err.includes('trx-') ||
        err.includes('info@torexjournal.com') ||
        err.includes('referência') ||
        err.includes('temporár') ||
        err.includes('descartáv') ||
        err.includes('temporary') ||
        err.includes('disposable') ||
        err.includes('domínio deste e-mail') ||
        err.includes('email domain') ||
        err.includes('senha') ||
        err.includes('password') ||
        err.includes('sequência') ||
        err.includes('sequence') ||
        err.includes('caractere') ||
        err.includes('character') ||
        err.includes('contacto') ||
        err.includes('prefixo');

    if (locale === 'en') {
        if (err.includes('email already registered')) return 'This email address is already linked to an account.';
        if (err.includes('invalid or expired otp')) return 'Invalid or expired verification code. Please request a new one.';
        if (err.includes('otp is required')) return 'Email verification code is required.';
        if (err.includes('connect')) return 'Unable to reach the server. Check your connection and try again.';
        if (err.includes('validation')) return 'Invalid input. Please review the highlighted fields.';
        if (isDirectPolicyMessage && original) return original;
        if (!original) return 'Unable to complete registration. Please try again.';
        return `Unable to complete registration: ${original}`;
    }
    if (err.includes('email already registered')) return 'Este endereço de e-mail já está associado a uma conta.';
    if (err.includes('invalid or expired otp')) return 'Código de verificação inválido ou expirado. Tente novamente.';
    if (err.includes('otp is required')) return 'O código de verificação é obrigatório.';
    if (err.includes('connect')) return 'Falha na comunicação com o servidor. Verifique sua conexão.';
    if (err.includes('validation')) return 'Dados inválidos. Verifique as informações preenchidas.';
    if (isDirectPolicyMessage && original) return original;
    if (!original) return 'Não foi possível concluir o seu cadastro. Tente novamente.';
    return `Não foi possível concluir o seu cadastro. Detalhes: ${original}`;
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;
