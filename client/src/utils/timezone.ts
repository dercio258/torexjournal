/**
 * Utilitário unificado de Fuso Horário do Torex Journal.
 *
 * Padrão Canônico da Plataforma:
 *  1. Armazenamento & Transporte (Backend / PostgreSQL / ClickHouse / Redis / IndexedDB):
 *     SEMPRE em UTC real (`ISO-8601` com `Z` ou epoch ms UTC), já compensando o fuso horário do
 *     servidor MT5 da corretora (ex.: `GMT+0` na Deriv/Exness, `GMT+2` inverno / `GMT+3` US-DST em prop firms).
 *  2. Exibição na UI & Exportações (`/dashboard`, `/trades`, `/trades/:id`, `/journal`, `/reports`):
 *     SEMPRE convertido para o fuso horário local do trader (ex.: `Africa/Maputo` `UTC+02:00`,
 *     `America/Sao_Paulo` `UTC-03:00`, `Europe/Lisbon`), garantindo que uma operação aberta às
 *     `15:00` no relógio do usuário apareça exatamente às `15:00` em todas as telas!
 */

const TZ_STORAGE_KEY = 'torex_user_timezone';

let cachedResolvedTz: string | null = null;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale}|${JSON.stringify(options)}`;
    let fmt = formatterCache.get(key);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat(locale, options);
        formatterCache.set(key, fmt);
    }
    return fmt;
}

export function isValidTimeZone(tz?: string | null): boolean {
    if (!tz || typeof tz !== 'string') return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
        return true;
    } catch {
        return false;
    }
}

export function getUserTimeZone(preferredTz?: string | null): string {
    if (preferredTz && isValidTimeZone(preferredTz)) {
        return preferredTz.trim();
    }
    try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(TZ_STORAGE_KEY) : null;
        if (stored && isValidTimeZone(stored)) {
            return stored.trim();
        }
    } catch {
        // ignore storage errors
    }
    if (!cachedResolvedTz) {
        try {
            const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            cachedResolvedTz = browserTz && isValidTimeZone(browserTz) ? browserTz : 'UTC';
        } catch {
            cachedResolvedTz = 'UTC';
        }
    }
    return cachedResolvedTz;
}

export function setUserTimeZonePreference(tz: string | null): void {
    try {
        if (typeof window === 'undefined') return;
        if (!tz || !tz.trim()) {
            window.localStorage.removeItem(TZ_STORAGE_KEY);
        } else if (isValidTimeZone(tz)) {
            window.localStorage.setItem(TZ_STORAGE_KEY, tz.trim());
        }
    } catch {
        // ignore storage errors
    }
}

export function getUserUtcOffsetLabel(refDate: Date = new Date(), timeZone?: string): string {
    const tz = getUserTimeZone(timeZone);
    try {
        const parts = getFormatter('en-US', {
            timeZone: tz,
            timeZoneName: 'shortOffset',
        }).formatToParts(refDate);
        const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
        if (offsetPart === 'GMT' || offsetPart === 'UTC') return 'UTC+00:00';
        const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
        if (match) {
            const sign = match[1];
            const hh = match[2].padStart(2, '0');
            const mm = (match[3] || '00').padStart(2, '0');
            return `UTC${sign}${hh}:${mm}`;
        }
    } catch {
        // fallback to Date.getTimezoneOffset
    }
    const offsetMin = -refDate.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mm = String(absMin % 60).padStart(2, '0');
    return `UTC${sign}${hh}:${mm}`;
}

/**
 * Converte qualquer valor de data/hora retornado pela API (ISO com `Z`, epoch em segundos/ms ou
 * string SQL sem sufixo de fuso) em uma instância `Date` UTC exata.
 */
export function parseTradeTimestamp(val: unknown): Date | null {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date) {
        return Number.isNaN(val.getTime()) ? null : val;
    }
    if (typeof val === 'number') {
        if (!Number.isFinite(val) || val <= 0) return null;
        const ms = val > 1e11 ? val : val * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        if (/^\d{10,13}$/.test(trimmed)) {
            const num = Number(trimmed);
            const ms = num > 1e11 ? num : num * 1000;
            const d = new Date(ms);
            return Number.isNaN(d.getTime()) ? null : d;
        }
        // Apenas data YYYY-MM-DD: preserva meia-noite local para não recuar 1 dia
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            const [y, m, d] = trimmed.split('-').map(Number);
            const localMidnight = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0);
            return Number.isNaN(localMidnight.getTime()) ? null : localMidnight;
        }
        // String ISO/SQL de data+hora sem sufixo explícito de fuso -> interpreta como UTC canônico
        if (
            /^\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}/.test(trimmed) &&
            !/[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed)
        ) {
            const isoUtc = `${trimmed.replace(/\//g, '-').replace(/\./g, '-').replace(' ', 'T')}Z`;
            const dUtc = new Date(isoUtc);
            if (!Number.isNaN(dUtc.getTime())) return dUtc;
        }
        const direct = new Date(trimmed);
        return Number.isNaN(direct.getTime()) ? null : direct;
    }
    return null;
}

export function formatTradeDateTime(
    val: unknown,
    options?: { includeSeconds?: boolean; timeZone?: string; fallback?: string }
): string {
    const fallback = options?.fallback ?? '—';
    const d = parseTradeTimestamp(val);
    if (!d) return fallback;
    const tz = getUserTimeZone(options?.timeZone);
    const includeSeconds = options?.includeSeconds ?? true;
    return getFormatter('pt-BR', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? { second: '2-digit' } : {}),
    }).format(d);
}

export function formatTradeDateShortTime(val: unknown, timeZone?: string): string {
    const d = parseTradeTimestamp(val);
    if (!d) return '';
    const tz = getUserTimeZone(timeZone);
    return getFormatter('pt-BR', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(d);
}

export function formatTradeDate(val: unknown, timeZone?: string, fallback = '—'): string {
    const d = parseTradeTimestamp(val);
    if (!d) return fallback;
    const tz = getUserTimeZone(timeZone);
    return getFormatter('pt-BR', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(d);
}

export function formatTradeTime(
    val: unknown,
    options?: { includeSeconds?: boolean; timeZone?: string; fallback?: string }
): string {
    const fallback = options?.fallback ?? '—';
    const d = parseTradeTimestamp(val);
    if (!d) return fallback;
    const tz = getUserTimeZone(options?.timeZone);
    const includeSeconds = options?.includeSeconds ?? true;
    return getFormatter('pt-BR', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? { second: '2-digit' } : {}),
    }).format(d);
}

export function formatTradeMt5Local(val: unknown, timeZone?: string): string {
    const d = parseTradeTimestamp(val);
    if (!d) return '';
    const tz = getUserTimeZone(timeZone);
    const parts = getFormatter('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.year || '1970'}.${map.month || '01'}.${map.day || '01'} ${map.hour || '00'}:${map.minute || '00'}:${map.second || '00'}`;
}

/**
 * Retorna a chave de data `YYYY-MM-DD` no fuso horário local do usuário.
 */
export function toLocalDateKey(val: unknown, timeZone?: string): string {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
        return val.trim();
    }
    const d = parseTradeTimestamp(val);
    if (!d) return '';
    const tz = getUserTimeZone(timeZone);
    const parts = getFormatter('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(d);
    let y = '';
    let m = '';
    let day = '';
    for (const p of parts) {
        if (p.type === 'year') y = p.value;
        else if (p.type === 'month') m = p.value;
        else if (p.type === 'day') day = p.value;
    }
    return y && m && day ? `${y}-${m}-${day}` : '';
}

/**
 * Retorna o índice do dia da semana (0 = Domingo .. 6 = Sábado) no fuso horário local do usuário.
 */
export function getLocalWeekdayIndex(val: unknown, timeZone?: string): number {
    const d = parseTradeTimestamp(val);
    if (!d) return 0;
    const tz = getUserTimeZone(timeZone);
    const wd = getFormatter('en-US', {
        timeZone: tz,
        weekday: 'short',
    }).format(d);
    const map: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };
    return map[wd] ?? d.getDay();
}
