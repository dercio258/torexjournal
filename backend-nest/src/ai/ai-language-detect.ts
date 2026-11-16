export type AiLocale = 'pt' | 'en';

const PT_WORDS = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'que', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'como', 'porque', 'porquê', 'por', 'para',
    'com', 'sem', 'meu', 'minha', 'meus', 'minhas', 'eu', 'tu', 'você', 'voce', 'não', 'nao', 'sim',
    'é', 'e', 'são', 'sao', 'estou', 'está', 'esta', 'tenho', 'tem', 'foi', 'ser', 'fazer', 'qual',
    'onde', 'quando', 'mais', 'menos', 'melhor', 'pior', 'hoje', 'ontem', 'semana', 'mês', 'mes',
    'obrigado', 'obrigada', 'olá', 'ola', 'oi', 'bom', 'dia', 'perdas', 'perda', 'ganhos', 'lucro',
    'conta', 'operações', 'operacoes', 'estratégia', 'estrategia', 'posso', 'devo', 'tudo', 'isso',
]);

const EN_WORDS = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'without', 'is', 'are', 'was', 'were',
    'what', 'which', 'how', 'why', 'when', 'where', 'who', 'my', 'me', 'i', 'you', 'your', 'do', 'does',
    'did', 'can', 'should', 'could', 'would', 'have', 'has', 'not', 'no', 'yes', 'and', 'or', 'it',
    'this', 'that', 'much', 'many', 'more', 'less', 'best', 'worst', 'today', 'yesterday', 'week',
    'month', 'thanks', 'thank', 'hello', 'hi', 'hey', 'losses', 'loss', 'profit', 'account', 'trades',
    'strategy', 'all', 'show', 'give', 'tell', 'am', 'be',
]);

/**
 * Detects whether the user wrote in Portuguese or English, so the reply follows the question
 * rather than the UI language. Ambiguous or very short input keeps the UI locale.
 */
export function detectQuestionLocale(text: string, fallback: AiLocale): AiLocale {
    const lower = String(text || '').toLowerCase();
    const tokens = lower.match(/[a-zà-ÿ']+/g) || [];
    let pt = 0;
    let en = 0;
    for (const t of tokens) {
        // 'a' exists in both languages: ignore it.
        if (t === 'a') continue;
        if (PT_WORDS.has(t)) pt += 1;
        if (EN_WORDS.has(t)) en += 1;
    }
    // Portuguese diacritics are strong evidence.
    if (/[ãõçáéíóúâêôà]/.test(lower)) pt += 2;
    if (/\b(i'm|don't|what's|it's|can't)\b/.test(lower)) en += 2;

    if (pt === en) return fallback;
    const winner: AiLocale = pt > en ? 'pt' : 'en';
    // A single weak hit is not enough to override the UI language.
    if (Math.max(pt, en) < 2 && Math.abs(pt - en) < 2) return fallback;
    return winner;
}
