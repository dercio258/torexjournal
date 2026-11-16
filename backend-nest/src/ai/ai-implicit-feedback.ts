/**
 * Implicit feedback: what the user does after a reply says whether it helped,
 * even when they never press 👍 or 👎.
 *
 * - REPHRASE          the user asks nearly the same thing again shortly after → the reply missed (−0.5)
 * - SUGGESTION_CLICK  the user follows one of the reply's suggestions → useful (+0.3)
 * - ACTION_CLICK      the user opens a page the reply linked (sent by the client) → useful (+0.3)
 * - COPY              the user copies the reply (sent by the client) → useful (+0.3)
 * - CONTINUATION      the user carries on the conversation on a new point → acceptable (+0.2)
 */

export type ImplicitSignal = 'REPHRASE' | 'SUGGESTION_CLICK' | 'ACTION_CLICK' | 'COPY' | 'CONTINUATION';

export const IMPLICIT_SIGNAL_WEIGHTS: Record<ImplicitSignal, number> = {
    REPHRASE: -0.5,
    SUGGESTION_CLICK: 0.3,
    ACTION_CLICK: 0.3,
    COPY: 0.3,
    CONTINUATION: 0.2,
};

/** Signals the client may report; the others are detected on the server. */
export const CLIENT_REPORTED_SIGNALS: ImplicitSignal[] = ['ACTION_CLICK', 'COPY'];

export const REPHRASE_WINDOW_MS = 90_000;
export const CONTINUATION_WINDOW_MS = 10 * 60_000;
const REPHRASE_SIMILARITY = 0.5;

/** Replies that are not answers (fallbacks, consent prompts, greetings) never receive implicit signals. */
const NON_RATEABLE_INTENTS = new Set(['support_fallback', 'profile_consent', 'greeting', 'zero_data_guard']);

export interface ConversationTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    intent?: string | null;
    createdAt: Date;
    suggestions?: string[];
}

export interface DetectedImplicitSignal {
    signal: ImplicitSignal;
    weight: number;
    targetMessageId: string;
}

const STOPWORDS = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'e', 'que', 'meu', 'minha', 'eu', 'é', 'em', 'no', 'na',
    'para', 'por', 'com', 'se', 'the', 'a', 'an', 'of', 'is', 'my', 'i', 'to', 'in', 'on', 'and', 'what', 'qual',
]);

export function normaliseForSignals(text: string): string {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function contentTokens(text: string): Set<string> {
    return new Set(
        normaliseForSignals(text)
            .split(' ')
            .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    );
}

export function tokenSimilarity(a: string, b: string): number {
    const ta = contentTokens(a);
    const tb = contentTokens(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    return inter / Math.min(ta.size, tb.size);
}

/**
 * Looks at the turns just before a new user message and says what that message
 * implies about the previous assistant reply. Returns null when nothing can be inferred.
 */
export function detectImplicitSignal(
    newUserText: string,
    previousTurns: ConversationTurn[],
    now: Date = new Date()
): DetectedImplicitSignal | null {
    const turns = [...previousTurns].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    if (!lastAssistant || NON_RATEABLE_INTENTS.has(String(lastAssistant.intent || ''))) return null;

    const lastUser = [...turns]
        .reverse()
        .find((t) => t.role === 'user' && t.createdAt.getTime() <= lastAssistant.createdAt.getTime());
    const sinceReply = now.getTime() - lastAssistant.createdAt.getTime();
    if (sinceReply < 0 || sinceReply > CONTINUATION_WINDOW_MS) return null;

    const typed = normaliseForSignals(newUserText);
    if (!typed) return null;

    const clicked = (lastAssistant.suggestions || []).some((s) => normaliseForSignals(s) === typed);
    if (clicked) {
        return { signal: 'SUGGESTION_CLICK', weight: IMPLICIT_SIGNAL_WEIGHTS.SUGGESTION_CLICK, targetMessageId: lastAssistant.id };
    }

    if (
        lastUser &&
        sinceReply <= REPHRASE_WINDOW_MS &&
        tokenSimilarity(newUserText, lastUser.content) >= REPHRASE_SIMILARITY
    ) {
        return { signal: 'REPHRASE', weight: IMPLICIT_SIGNAL_WEIGHTS.REPHRASE, targetMessageId: lastAssistant.id };
    }

    return { signal: 'CONTINUATION', weight: IMPLICIT_SIGNAL_WEIGHTS.CONTINUATION, targetMessageId: lastAssistant.id };
}

/**
 * Explicit vote requested on the first analyst reply of a conversation and every 5th after it,
 * so users are asked often enough to learn from, but not on every message.
 */
export function shouldAskForVote(analystRepliesInSessionIncludingThis: number): boolean {
    return analystRepliesInSessionIncludingThis > 0 && (analystRepliesInSessionIncludingThis - 1) % 5 === 0;
}
