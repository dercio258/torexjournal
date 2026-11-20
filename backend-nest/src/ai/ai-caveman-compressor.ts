/**
 * Torex AI — Caveman Token Compression Engine
 * Adaptado dos princípios de economia de tokens do projeto open-source `JuliusBrussee/caveman`:
 * reduz drasticamente tokens internos (prompts, histórico de turnos, JSONs SQL/RAG) removendo
 * enchimento, artigos supérfluos e indentação, preservando 100% dos números, tickers, datas e rotas.
 */

export type CavemanCompressionLevel = 'lite' | 'full' | 'ultra';

export interface CavemanSavingsReport {
    rawChars: number;
    compressedChars: number;
    rawTokens: number;
    compressedTokens: number;
    savedTokens: number;
    savedPct: number;
}

const FILLER_PHRASES_RX =
    /\b(?:com\s+base\s+na\s+an[aá]lise(?:\s+dos\s+seus\s+dados)?|[eé]\s+importante\s+(?:destacar|notar|salientar)\s+que|vale\s+(?:a\s+pena\s+)?(?:mencionar|ressaltar)\s+que|de\s+modo\s+geral|de\s+forma\s+geral|por\s+favor|gostaria\s+de\s+saber|poderia\s+me\s+dizer|basicamente|atualmente\s+na\s+verdade|in\s+order\s+to|it\s+is\s+important\s+to\s+note\s+that|please\s+note\s+that|generally\s+speaking|as\s+a\s+matter\s+of\s+fact)\b/gi;

const REDUNDANT_ARTICLES_RX =
    /\b(?:o|a|os|as|um|uma|uns|umas|ao|aos|[àa]s|pelo|pela|pelos|pelas|the|an)\b/gi;

const SENTINEL_SHORT_MAP: Array<[RegExp, string]> = [
    [/^N[aã]o preenchido pelo utilizador$/i, 'N/A'],
    [/^Nenhum dia com alerta f[ií]sico\/emocional registado no Di[aá]rio$/i, '0_PSYCH_ALERTS'],
    [/^Nenhuma regra escrita registada na aba General do Di[aá]rio$/i, '0_PLAYBOOK_RULES'],
    [/^Existem 0 regras escritas no Playbook:.*$/i, '0_RULES_NO_DEVIATION_CLAIM'],
    [/^Conta sem nenhuma opera[cç][aã]o registada\.$/i, '0_TRADES'],
    [/^Sem perdas registadas \(0 stops na amostra\)$/i, '0_LOSSES'],
    [/^N[aã]o dispon[ií]vel$/i, 'N/A'],
    [/^N[aã]o configurado$/i, 'UNSET'],
];

/** Estimativa determinística de tokens BPE (~3.8 chars/token para PT/EN/JSON). */
export function estimateTokens(text: string): number {
    const len = String(text || '').length;
    if (len === 0) return 0;
    return Math.ceil(len / 3.8);
}

export function measureCavemanSavings(
    rawText: string,
    compressedText: string,
): CavemanSavingsReport {
    const rawChars = String(rawText || '').length;
    const compressedChars = String(compressedText || '').length;
    const rawTokens = estimateTokens(rawText);
    const compressedTokens = estimateTokens(compressedText);
    const savedTokens = Math.max(0, rawTokens - compressedTokens);
    const savedPct =
        rawTokens > 0 ? Number(((savedTokens / rawTokens) * 100).toFixed(1)) : 0;

    return {
        rawChars,
        compressedChars,
        rawTokens,
        compressedTokens,
        savedTokens,
        savedPct,
    };
}

/**
 * Comprime prosa interna no estilo Caveman preservando trechos protegidos
 * (rotas `/...`, backticks `` `...` `` e valores numéricos/monetários).
 */
export function cavemanCompressText(
    input: string,
    level: CavemanCompressionLevel = 'full',
): string {
    const raw = String(input || '').trim();
    if (!raw) return '';

    const preserved: string[] = [];
    const masked = raw.replace(
        /(`[^`]+`|\/(?:add-trades|backtesting|journal|reports|trades|calendar|dashboard|configuration|payments|pricing|torex-ai)(?:\/[a-z0-9\-_]+)*|[-+]?\d+(?:[.,]\d+)?\s*(?:%|x\b|USD|EUR|MZN|BRL|k\b|mil\b)?)/gi,
        (match) => {
            const token = `__CVP_${preserved.length}__`;
            preserved.push(match);
            return token;
        },
    );

    let compressed = masked.replace(FILLER_PHRASES_RX, ' ');

    if (level === 'full' || level === 'ultra') {
        compressed = compressed.replace(REDUNDANT_ARTICLES_RX, ' ');
    }
    if (level === 'ultra') {
        compressed = compressed
            .replace(/\b(?:que|para|com|como|sobre|entre|that|which|with|from|into)\b/gi, ' ')
            .replace(/[;,]+/g, ' ');
    }

    compressed = compressed
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,:;!?])/g, '$1')
        .trim();

    return compressed.replace(/__CVP_(\d+)__/g, (_full, idxStr) => {
        const idx = Number(idxStr);
        return preserved[idx] ?? '';
    });
}

function compactValue(value: unknown, level: CavemanCompressionLevel): unknown {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (typeof value === 'string') {
        const clean = value.trim();
        if (!clean) return undefined;
        for (const [rx, replacement] of SENTINEL_SHORT_MAP) {
            if (rx.test(clean)) {
                return replacement;
            }
        }
        return level === 'ultra' && clean.length > 90
            ? cavemanCompressText(clean, 'full')
            : clean.replace(/\s+/g, ' ');
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        const items = value
            .map((item) => compactValue(item, level))
            .filter((item) => item !== undefined);
        return items.length > 0 ? items : undefined;
    }

    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const compacted = compactValue(v, level);
            if (compacted !== undefined) {
                out[k] = compacted;
            }
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }

    return value;
}

/**
 * Compacta payloads JSON estruturados (métricas SQL, snapshot da conta, chunks RAG)
 * mantendo todas as chaves numéricas exatas e removendo nulos/vazios/indentação.
 */
export function cavemanCompactPayload(
    data: unknown,
    level: CavemanCompressionLevel = 'full',
): string {
    if (data === null || data === undefined) return '{}';
    const compacted = compactValue(data, level);
    return JSON.stringify(compacted ?? {});
}

/**
 * Compacta o histórico conversacional enviado aos modelos internos (Router + Analyst),
 * preservando números recentes e comprimindo prosa antiga extensa.
 */
export function cavemanCompressHistory<
    T extends { role: 'user' | 'assistant'; content: string },
>(
    messages: T[],
    maxItems = 5,
    maxTurnChars = 420,
): T[] {
    const sliced = (messages || []).slice(-maxItems);
    return sliced
        .map((m, idx) => {
            const cleanRaw = String(m?.content || '')
                .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
                .trim();
            if (!cleanRaw) return null;

            const isMostRecent = idx === sliced.length - 1;
            const compacted =
                isMostRecent && cleanRaw.length <= 240
                    ? cleanRaw.slice(0, maxTurnChars)
                    : cavemanCompressText(cleanRaw, 'full').slice(0, maxTurnChars);

            return {
                ...m,
                content: compacted || cleanRaw.slice(0, maxTurnChars),
            } as T;
        })
        .filter((item): item is T => Boolean(item && item.content.length > 0));
}
