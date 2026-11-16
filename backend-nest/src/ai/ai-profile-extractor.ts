/**
 * Extracts what the user says about themselves ("sou o Dercio, tenho 22 anos, sou scalper")
 * and separates it from the actual question, so personal facts go to the private profile
 * and only the clean question reaches the router, the LLM and the shared memory.
 *
 * Age is detected only so it can be removed: it is never stored.
 */

export type ProfileFactType = 'NAME' | 'EXPERIENCE' | 'STYLE' | 'MARKETS' | 'GOAL';

export interface ProfileFact {
    type: ProfileFactType;
    /** Canonical value: a name, a code (BEGINNER, SCALPING, FOREX,GOLD, Y3) or a short goal text. */
    value: string;
}

export interface ProfileExtraction {
    facts: ProfileFact[];
    /** Personal data found and deliberately not kept. */
    discarded: Array<'AGE'>;
    /** The question without greeting, name and age; '' when the message was only an introduction. */
    cleanedText: string;
    isPureIntro: boolean;
    greeting: string | null;
}

const NOT_A_NAME = new Set([
    'trader', 'iniciante', 'novato', 'novo', 'nova', 'principiante', 'scalper', 'swing', 'day', 'position',
    'melhor', 'pior', 'unico', 'único', 'unica', 'única', 'mesmo', 'mesma', 'cliente', 'utilizador', 'usuario',
    'usuário', 'dono', 'admin', 'aluno', 'aluna', 'estudante', 'profissional', 'intermediario', 'intermediário',
    'avancado', 'avançado', 'experiente', 'de', 'da', 'do', 'um', 'uma', 'o', 'a', 'tipo', 'fa', 'fã',
    'beginner', 'new', 'losing', 'trying', 'not', 'very', 'so', 'here', 'back', 'still', 'from', 'student',
    'professional', 'intermediate', 'advanced', 'experienced', 'a', 'an', 'the', 'going', 'looking', 'interested',
    'favor', 'primeiro', 'primeira', 'responsavel', 'responsável', 'culpado', 'quem', 'eu','voce', 'você', 'teu', 'seu', 'sim', 'nao', 'não', 'yes', 'no', 'ok',
]);

// `(?!\p{L})` instead of `\b`: `\b` is ASCII-only, so it never matches after "Olá".
const GREETING_RX = /^\s*(ol[aá]|oi|ola|bom dia|boa tarde|boa noite|viva|hello|hi|hey|good (?:morning|afternoon|evening))(?!\p{L})[\s,!.]*/iu;

// Names: with an explicit cue ("me chamo", "my name is") any case is accepted;
// "sou o/a X" accepts any case; bare "sou X" / "I'm X" only a capitalised word.
const NAME_PATTERNS: Array<{ rx: RegExp; needsCapital: boolean }> = [
    { rx: /\b(?:me\s+chamo|chamo-me|(?:o\s+)?meu\s+nome\s+(?:é|e)|my\s+name\s+is|call\s+me)\s+([\p{L}][\p{L}'-]{1,29})/iu, needsCapital: false },
    { rx: /\b(?:eu\s+)?sou\s+(?:o|a)\s+([\p{L}][\p{L}'-]{1,29})/iu, needsCapital: false },
    { rx: /\b(?:[Ee]u\s+)?[Ss]ou\s+(\p{Lu}[\p{L}'-]{1,29})/u, needsCapital: true },
    { rx: /\b(?:[Ii]\s*['’]?\s*m|[Ii]\s+am)\s+(\p{Lu}[\p{L}'-]{1,29})/u, needsCapital: true },
];

const EXPERIENCE_TAIL = /^\s*(?:de\s+experi|de\s+trading|de\s+mercado|a\s+operar|nos\s+mercados|of\s+experience|of\s+trading|trading|in\s+the\s+market)/i;
const AGE_RX = /\b(?:tenho|i\s*'?\s*m|i\s+am)\s+(\d{1,2})\s*(?:anos(?:\s+de\s+idade)?|years?(?:\s+old)?|y\.?o\.?)\b/i;

const LEVEL_PATTERNS: Array<{ rx: RegExp; value: string }> = [
    { rx: /\b(iniciante|novato|principiante|beginner|newbie|comecei\s+agora|just\s+started|estou\s+a\s+come[cç]ar|estou\s+come[cç]ando)\b/i, value: 'BEGINNER' },
    { rx: /\b(intermedi[aá]rio|intermediate)\b/i, value: 'INTERMEDIATE' },
    { rx: /\b(?:sou|i\s*'?\s*m|i\s+am)\s+(?:um\s+|uma\s+|an?\s+)?(?:trader\s+)?(avan[cç]ado|experiente|profissional|advanced|experienced|professional)\b/i, value: 'ADVANCED' },
];
const DURATION_PATTERNS: RegExp[] = [
    /\b(?:opero|fa[cç]o\s+trading|negoceio|negocio|trado)\s+(?:h[aá]|faz)\s+(\d{1,2})\s+(anos?|mes(?:es)?)/i,
    /\btenho\s+(\d{1,2})\s+(anos?|mes(?:es)?)\s+de\s+(?:experi[eê]ncia|trading|mercado)/i,
    /\b(?:been\s+)?trading\s+for\s+(\d{1,2})\s+(years?|months?)/i,
    /\b(\d{1,2})\s+(years?|months?)\s+of\s+(?:experience|trading)/i,
];

const STYLE_MAP: Array<{ rx: RegExp; value: string }> = [
    { rx: /\b(?:sou|i\s*'?\s*m|i\s+am)\s+(?:um\s+|uma\s+|an?\s+)?scalper\b|\b(?:fa[cç]o|opero|pratico|i\s+do)\s+(?:o\s+)?scalping\b|\bi\s+scalp\b/i, value: 'SCALPING' },
    { rx: /\b(?:sou|i\s*'?\s*m|i\s+am)\s+(?:um\s+|uma\s+|an?\s+)?day\s*trader\b|\b(?:fa[cç]o|opero|pratico|i\s+do)\s+day\s*trad(?:e|ing)\b/i, value: 'DAY_TRADING' },
    { rx: /\b(?:sou|i\s*'?\s*m|i\s+am)\s+(?:um\s+|uma\s+|an?\s+)?swing\s*trader\b|\b(?:fa[cç]o|opero|pratico|i\s+do)\s+swing(?:\s*trad(?:e|ing))?\b/i, value: 'SWING_TRADING' },
    { rx: /\b(?:sou|i\s*'?\s*m|i\s+am)\s+(?:um\s+|uma\s+|an?\s+)?position\s*trader\b/i, value: 'POSITION_TRADING' },
];

const MARKET_CUE = /\b(?:opero|negoceio|negocio|trado|fa[cç]o\s+trading\s+(?:de|em|no|na)|i\s+trade|i\s+mostly\s+trade|i\s+trade\s+mainly)\s+([^.?!;]{2,60})/i;
const MARKET_WORDS: Array<{ rx: RegExp; value: string }> = [
    { rx: /\b(forex|fx|c[aâ]mbio|moedas|currencies)\b/i, value: 'FOREX' },
    { rx: /\b([ií]ndices|indices|nasdaq|us30|us100|sp500|s&p|dax|dow)\b/i, value: 'INDICES' },
    { rx: /\b(cripto|crypto|criptomoedas|bitcoin|btc)\b/i, value: 'CRYPTO' },
    { rx: /\b(ouro|gold|xauusd)\b/i, value: 'GOLD' },
    { rx: /\b(a[cç][oõ]es|stocks|equities)\b/i, value: 'STOCKS' },
    { rx: /\b(futuros|futures)\b/i, value: 'FUTURES' },
    { rx: /\b(sint[eé]ticos|synthetics|volatility\s+\d+|boom|crash)\b/i, value: 'SYNTHETICS' },
];

const GOAL_PATTERNS: RegExp[] = [
    /\b(?:o\s+)?meu\s+objetivo\s+(?:é|e)\s+([^.?!;]{5,80})/i,
    /\bmy\s+goal\s+is\s+(?:to\s+)?([^.?!;]{5,80})/i,
];
const PROP_GOAL_RX = /\b(?:quero|preciso|vou|want\s+to|need\s+to|trying\s+to)\s+(?:passar|pass)\s+(?:n[oa]\s+|the\s+|a\s+|my\s+)?(?:desafio|challenge|prop\s*firm|ftmo|avalia[cç][aã]o|evaluation)/i;

function capitalise(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function removeSpan(text: string, rx: RegExp): string {
    return text.replace(rx, ' ');
}

export function extractProfileFacts(rawText: string): ProfileExtraction {
    const text = String(rawText || '').trim();
    const facts: ProfileFact[] = [];
    const discarded: Array<'AGE'> = [];
    let cleaned = text;

    const greetingMatch = text.match(GREETING_RX);
    const greeting = greetingMatch ? greetingMatch[1] : null;

    // NAME
    for (const { rx, needsCapital } of NAME_PATTERNS) {
        const m = text.match(rx);
        if (!m) continue;
        const candidate = m[1];
        if (NOT_A_NAME.has(candidate.toLowerCase())) continue;
        if (needsCapital && candidate.charAt(0) !== candidate.charAt(0).toUpperCase()) continue;
        facts.push({ type: 'NAME', value: capitalise(candidate) });
        cleaned = removeSpan(cleaned, new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        break;
    }

    // AGE (never stored)
    const age = text.match(AGE_RX);
    if (age) {
        const tail = text.slice((age.index || 0) + age[0].length);
        if (!EXPERIENCE_TAIL.test(tail)) {
            discarded.push('AGE');
            cleaned = removeSpan(cleaned, AGE_RX);
        }
    }

    // EXPERIENCE: duration first, then level words
    let experience: string | null = null;
    for (const rx of DURATION_PATTERNS) {
        const m = text.match(rx);
        if (m) {
            const n = Number(m[1]);
            const isYear = /^(ano|year)/i.test(m[2]);
            if (n > 0 && n < 60) experience = `${isYear ? 'Y' : 'M'}${n}`;
            break;
        }
    }
    if (!experience) {
        for (const { rx, value } of LEVEL_PATTERNS) {
            if (rx.test(text)) {
                experience = value;
                break;
            }
        }
    }
    if (experience) facts.push({ type: 'EXPERIENCE', value: experience });

    // STYLE
    for (const { rx, value } of STYLE_MAP) {
        if (rx.test(text)) {
            facts.push({ type: 'STYLE', value });
            break;
        }
    }

    // MARKETS
    const marketClause = text.match(MARKET_CUE);
    if (marketClause) {
        const markets = MARKET_WORDS.filter(({ rx }) => rx.test(marketClause[1])).map((m) => m.value);
        if (markets.length) facts.push({ type: 'MARKETS', value: markets.join(',') });
    }

    // GOAL
    let goal: string | null = null;
    for (const rx of GOAL_PATTERNS) {
        const m = text.match(rx);
        if (m) {
            goal = m[1].trim().replace(/\s+/g, ' ').slice(0, 80);
            break;
        }
    }
    if (!goal && PROP_GOAL_RX.test(text)) goal = 'PASS_PROP_CHALLENGE';
    if (goal) facts.push({ type: 'GOAL', value: goal });

    // Clean question: drop greeting, name and age; then leftover connectors and punctuation.
    if (greeting) cleaned = cleaned.replace(GREETING_RX, ' ');
    cleaned = cleaned
        .replace(/\s+/g, ' ')
        .replace(/(^|[,.;!]\s*)(?:e|and|eu|,)\s+(?=\S)/gi, '$1')
        .replace(/^[\s,.;:!-]+/, '')
        .replace(/\s*,\s*(?:,\s*)+/g, ', ')
        .replace(/^(?:e|and|eu)\s+/i, '')
        .trim();

    const hasIntro = facts.some((f) => f.type === 'NAME') || discarded.length > 0;
    const meaningful = cleaned.replace(/[^\p{L}\p{N}]/gu, '');
    const isPureIntro = hasIntro && meaningful.length < 3;

    return {
        facts,
        discarded,
        cleanedText: hasIntro ? (isPureIntro ? '' : cleaned) : text,
        isPureIntro,
        greeting,
    };
}

/** Short replies to the "remember me?" question, and explicit "forget me" commands. */
export function detectConsentReply(rawText: string): 'GRANT' | 'DENY' | 'FORGET' | null {
    const t = String(rawText || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!t || t.length > 60) return null;
    if (/^(esquece|apaga|apague|elimina|forget|delete|erase)\b.*\b(perfil|meu nome|o que sabes|tudo sobre mim|me|my profile|my name|about me)\b/.test(t)) {
        return 'FORGET';
    }
    if (/^(sim|yes|claro|pode|podes|ok|sure|yep)\b.*\b(lembra|lembre|lembrar|guardar|guarda|remember|save|memoriza)/.test(t) || /^(lembra te de mim|remember me|pode guardar|podes guardar)$/.test(t)) {
        return 'GRANT';
    }
    if (/^(nao|no|nope)\b.*\b(guardar|guardes|guarde|lembres|lembre|lembrar|remember|save|obrigado|thanks)/.test(t) || /^(nao guardar|don t remember|do not remember|dont remember|do not save|don t save)$/.test(t)) {
        return 'DENY';
    }
    return null;
}

export function formatProfileFact(fact: ProfileFact, locale: 'pt' | 'en'): string {
    const isEn = locale === 'en';
    const labels: Record<ProfileFactType, [string, string]> = {
        NAME: ['Nome', 'Name'],
        EXPERIENCE: ['Experiência', 'Experience'],
        STYLE: ['Estilo', 'Style'],
        MARKETS: ['Mercados', 'Markets'],
        GOAL: ['Objetivo', 'Goal'],
    };
    const codes: Record<string, [string, string]> = {
        BEGINNER: ['iniciante', 'beginner'],
        INTERMEDIATE: ['intermédio', 'intermediate'],
        ADVANCED: ['avançado', 'advanced'],
        SCALPING: ['scalping', 'scalping'],
        DAY_TRADING: ['day trading', 'day trading'],
        SWING_TRADING: ['swing trading', 'swing trading'],
        POSITION_TRADING: ['position trading', 'position trading'],
        FOREX: ['Forex', 'Forex'],
        INDICES: ['índices', 'indices'],
        CRYPTO: ['cripto', 'crypto'],
        GOLD: ['ouro', 'gold'],
        STOCKS: ['ações', 'stocks'],
        FUTURES: ['futuros', 'futures'],
        SYNTHETICS: ['sintéticos', 'synthetics'],
        PASS_PROP_CHALLENGE: ['passar um desafio de prop firm', 'pass a prop firm challenge'],
    };
    let value = fact.value;
    const duration = /^([YM])(\d+)$/.exec(value);
    if (duration) {
        const n = Number(duration[2]);
        value = duration[1] === 'Y'
            ? (isEn ? `${n} year${n === 1 ? '' : 's'} trading` : `${n} ano${n === 1 ? '' : 's'} a operar`)
            : (isEn ? `${n} month${n === 1 ? '' : 's'} trading` : `${n} ${n === 1 ? 'mês' : 'meses'} a operar`);
    } else {
        value = value
            .split(',')
            .map((v) => (codes[v] ? codes[v][isEn ? 1 : 0] : v))
            .join(', ');
    }
    return `${labels[fact.type][isEn ? 1 : 0]}: ${value}`;
}
