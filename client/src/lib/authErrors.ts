/** Shared helpers for translating auth API failures into UI state. */

interface ApiErrorLike {
    response?: { status?: number; data?: { message?: string; error?: string } };
}

export const getApiMessage = (err: unknown, fallback: string): string => {
    const data = (err as ApiErrorLike)?.response?.data;
    return data?.message || data?.error || fallback;
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

/** Friendly Portuguese messages for known registration errors. */
export const getRegisterErrorMessage = (original: string): string => {
    const err = original?.toLowerCase() || '';
    if (err.includes('email already registered')) return 'Este endereço de e-mail já está associado a uma conta.';
    if (err.includes('invalid or expired otp')) return 'Código de verificação inválido ou expirado. Tente novamente.';
    if (err.includes('otp is required')) return 'O código de verificação é obrigatório.';
    if (err.includes('connect')) return 'Falha na comunicação com o servidor. Verifique sua conexão.';
    if (err.includes('validation')) return 'Dados inválidos. Verifique as informações preenchidas.';
    if (!original) return 'Não foi possível concluir o seu cadastro. Tente novamente.';
    return `Não foi possível concluir o seu cadastro. Detalhes: ${original}`;
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;
