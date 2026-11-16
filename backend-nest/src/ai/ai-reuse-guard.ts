/**
 * Reuse guard: a cached reply is served only when the new question asks the same thing,
 * not merely something that looks alike. Runs after the similarity score, on the single
 * best candidate, so it costs nothing on misses.
 *
 * Blocks the false reuses the AI lab measured ("o que é drawdown" served for
 * "qual é o meu drawdown") plus different symbols, periods or figures.
 */

const PERSONAL_RX =
    /\b(meu|minha|meus|minhas|estou|estava|tenho|tive|fiz|perdi|ganhei|opero|operei|my|mine|am i|i am|i m|do i|did i|have i|i lost|i made|i trade)\b/;

const PERIOD_RX =
    /\b(hoje|ontem|semana|mes|mês|ano|dias?|today|yesterday|week|month|year|days?|7d|14d|30d|90d)\b/g;

const SYMBOL_RX =
    /\b([a-z]{6}|xau[a-z]{3}|xag[a-z]{3}|us30|us100|us500|nas100|spx500|ger40|uk100|btc[a-z]{0,4}|eth[a-z]{0,4}|gold|ouro|nasdaq|dax|petroleo|oil)\b/g;

/** Six-letter words that are not tickers. */
const NOT_SYMBOLS = new Set([
    'quando', 'quanto', 'porque', 'perdas', 'ganhos', 'trades', 'minhas', 'sessao', 'estou', 'melhor', 'profit',
    'factor', 'payoff', 'stop', 'scalping', 'should', 'losses', 'trader', 'please', 'recent', 'during', 'analisa',
    'diario', 'semana', 'quanta', 'quais', 'devo', 'posso', 'conta', 'ultimo', 'ultima', 'agora', 'depois', 'before',
    'pullback', 'strategy', 'sessoes', 'average', 'medias', 'padrao', 'perder', 'ganhar', 'months', 'semanas',
]);
const CURRENCY_CODES = new Set(['usd', 'eur', 'gbp', 'jpy', 'chf', 'aud', 'nzd', 'cad', 'zar', 'mxn', 'try', 'sek', 'nok', 'sgd', 'hkd', 'cnh']);

function normalize(text: string): string {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function symbols(text: string): Set<string> {
    const out = new Set<string>();
    for (const m of text.matchAll(SYMBOL_RX)) {
        const s = m[1];
        if (s.length === 6 && /^[a-z]{6}$/.test(s) && !/^(xau|xag)/.test(s)) {
            // An FX pair is two currency codes; anything else six letters long is a word.
            if (!(CURRENCY_CODES.has(s.slice(0, 3)) && CURRENCY_CODES.has(s.slice(3)))) continue;
        }
        if (NOT_SYMBOLS.has(s)) continue;
        out.add(s === 'gold' || s === 'ouro' ? 'xauusd' : s);
    }
    return out;
}

function periods(text: string): Set<string> {
    const found = new Set<string>();
    for (const m of text.matchAll(PERIOD_RX)) found.add(m[1].replace(/s$/, ''));
    for (const m of text.matchAll(/\b(\d+)\b/g)) found.add(`n${m[1]}`);
    return found;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

export type ReuseGuardReason = 'PERSONAL_MISMATCH' | 'SYMBOL_MISMATCH' | 'PERIOD_MISMATCH';

/**
 * @param scope GLOBAL: shared concept/platform answers (personal questions never qualify);
 *              PRIVATE: the user's own cached answers (symbols and periods must still match).
 */
export function checkReuse(
    newQuestion: string,
    storedQuestion: string,
    scope: 'GLOBAL' | 'PRIVATE',
    options?: { domainCategory?: string | null }
): { ok: boolean; reason?: ReuseGuardReason } {
    const q = normalize(newQuestion);
    const s = normalize(storedQuestion);
    // Platform how-tos say "os meus trades" without being about the user's results,
    // so the personal/generic check applies to trading concepts only.
    const checkPersonal = scope === 'GLOBAL' && (options?.domainCategory ?? 'TRADING_CONCEPTS') === 'TRADING_CONCEPTS';
    if (checkPersonal && PERSONAL_RX.test(q) !== PERSONAL_RX.test(s)) {
        return { ok: false, reason: 'PERSONAL_MISMATCH' };
    }
    if (!sameSet(symbols(q), symbols(s))) return { ok: false, reason: 'SYMBOL_MISMATCH' };
    if (!sameSet(periods(q), periods(s))) return { ok: false, reason: 'PERIOD_MISMATCH' };
    return { ok: true };
}
