import { formatTradeTime } from '../../utils/timezone';
import { TradeBehaviorFeedbackInfo, TradeBehaviorMlInfo } from '../trades/BehaviorMlBadge';

export type JournalTab = 'daily' | 'trade' | 'general';

export type GeneralNoteCategory = 'PLAYBOOK' | 'RISK_RULES' | 'PSYCHOLOGY' | 'GENERAL';

export interface DailyJournalMetrics {
    totalTrades: number;
    closedTrades: number;
    wins: number;
    losses: number;
    breakevens: number;
    totalCommissions: number;
    grossPnl: number;
    netPnl: number;
    winRate: number | null;
    profitFactor: number | null;
    avgMfe: number | null;
    maxMfe: number | null;
    avgMae: number | null;
    maxMae: number | null;
}

export interface DailyPsychCheck {
    sleep?: string | null;
    energy?: string | null;
    focus?: string | null;
    caffeine?: string | null;
    moodState?: string | null;
    stress?: string | null;
}

export type PsychTone = 'accent' | 'warning' | 'danger' | 'data' | 'neutral';

export interface PsychOptionItem {
    value: string;
    labelEn?: string;
    emoji: string;
    tone: PsychTone;
}

export interface PsychDimensionConfig {
    key: keyof DailyPsychCheck;
    shortLabel: string;
    shortLabelEn?: string;
    fullLabel: string;
    fullLabelEn?: string;
    defaultEmoji: string;
    options: PsychOptionItem[];
}

export const DAILY_PSYCH_DIMENSIONS: PsychDimensionConfig[] = [
    {
        key: 'sleep',
        shortLabel: 'Sono',
        shortLabelEn: 'Sleep',
        fullLabel: 'Qualidade de Sono',
        fullLabelEn: 'Sleep Quality',
        defaultEmoji: '😴',
        options: [
            { value: 'Exausto', labelEn: 'Exhausted', emoji: '😵', tone: 'danger' },
            { value: 'Sonolento', labelEn: 'Drowsy', emoji: '🥱', tone: 'warning' },
            { value: 'Normal', labelEn: 'Normal', emoji: '😐', tone: 'neutral' },
            { value: 'Disposto', labelEn: 'Rested', emoji: '🙂', tone: 'accent' },
            { value: 'Excelente', labelEn: 'Peak', emoji: '🌟', tone: 'accent' },
        ],
    },
    {
        key: 'energy',
        shortLabel: 'Energia',
        shortLabelEn: 'Energy',
        fullLabel: 'Nível de Energia',
        fullLabelEn: 'Energy Level',
        defaultEmoji: '⚡',
        options: [
            { value: 'Esgotado', labelEn: 'Depleted', emoji: '🪫', tone: 'danger' },
            { value: 'Fadigado', labelEn: 'Fatigued', emoji: '😮‍💨', tone: 'warning' },
            { value: 'Normal', labelEn: 'Normal', emoji: '⚡', tone: 'neutral' },
            { value: 'Confiante', labelEn: 'Charged', emoji: '💪', tone: 'accent' },
            { value: 'Hiperativo', labelEn: 'Overcharged', emoji: '🔥', tone: 'warning' },
        ],
    },
    {
        key: 'focus',
        shortLabel: 'Foco',
        shortLabelEn: 'Focus',
        fullLabel: 'Nível de Foco',
        fullLabelEn: 'Focus Level',
        defaultEmoji: '🎯',
        options: [
            { value: 'Distraído', labelEn: 'Distracted', emoji: '🌀', tone: 'danger' },
            { value: 'Frágil', labelEn: 'Scattered', emoji: '🧩', tone: 'warning' },
            { value: 'Foco funcional', labelEn: 'Locked In', emoji: '🎯', tone: 'accent' },
            { value: 'Hiper foco', labelEn: 'Deep Flow', emoji: '🧠', tone: 'data' },
        ],
    },
    {
        key: 'caffeine',
        shortLabel: 'Cafeína',
        shortLabelEn: 'Caffeine',
        fullLabel: 'Consumo de Cafeína',
        fullLabelEn: 'Caffeine Intake',
        defaultEmoji: '☕',
        options: [
            { value: 'Consumo crítico', labelEn: 'Excessive', emoji: '🚨', tone: 'danger' },
            { value: 'Elevado', labelEn: 'High', emoji: '☕', tone: 'warning' },
            { value: 'Normal', labelEn: 'Moderate', emoji: '🍵', tone: 'neutral' },
            { value: 'Baixo', labelEn: 'Low', emoji: '💧', tone: 'accent' },
            { value: 'Sem consumo', labelEn: 'None', emoji: '🚫', tone: 'accent' },
        ],
    },
    {
        key: 'moodState',
        shortLabel: 'Humor',
        shortLabelEn: 'Mood',
        fullLabel: 'Estado do Humor',
        fullLabelEn: 'Emotional State',
        defaultEmoji: '😌',
        options: [
            { value: 'Estressado', labelEn: 'Stressed', emoji: '😡', tone: 'danger' },
            { value: 'Ansioso', labelEn: 'Anxious', emoji: '😰', tone: 'warning' },
            { value: 'Preocupado', labelEn: 'Uneasy', emoji: '😟', tone: 'warning' },
            { value: 'Calmo', labelEn: 'Composed', emoji: '😌', tone: 'accent' },
            { value: 'Eufórico', labelEn: 'Euphoric', emoji: '🤩', tone: 'warning' },
        ],
    },
    {
        key: 'stress',
        shortLabel: 'Estresse',
        shortLabelEn: 'Stress',
        fullLabel: 'Nível de Estresse',
        fullLabelEn: 'Stress Level',
        defaultEmoji: '🍃',
        options: [
            { value: 'Excessivo', labelEn: 'High', emoji: '🌋', tone: 'danger' },
            { value: 'Normal', labelEn: 'Baseline', emoji: '⚖️', tone: 'neutral' },
            { value: 'Baixo', labelEn: 'Low', emoji: '🍃', tone: 'accent' },
        ],
    },
];

export function getPsychToneClass(tone: PsychTone): string {
    switch (tone) {
        case 'accent':
            return 'bg-accent/15 text-accent border-accent/35 font-medium';
        case 'warning':
            return 'bg-warning/15 text-warning border-warning/35 font-medium';
        case 'danger':
            return 'bg-danger/15 text-danger border-danger/35 font-medium';
        case 'data':
            return 'bg-data-1/15 text-data-1 border-data-1/35 font-medium';
        case 'neutral':
        default:
            return 'bg-surface-2 text-fg border-line-strong font-medium';
    }
}

export interface DailyNotePayload {
    id: string | null;
    date: string;
    title: string | null;
    content: string;
    mood: string | null;
    marketBias: string | null;
    psychCheck?: DailyPsychCheck;
    images: string[];
    updatedAt?: string;
}

export interface TradePsychCheck {
    feeling?: string | null;
    followingPlan?: string | null;
    entryDriver?: string | null;
    riskComfort?: string | null;
}

export interface TradePsychQuestionConfig {
    key: keyof TradePsychCheck;
    shortQuestion: string;
    shortQuestionEn?: string;
    fullQuestion: string;
    fullQuestionEn?: string;
    options: PsychOptionItem[];
}

export const TRADE_PSYCH_QUESTIONS: TradePsychQuestionConfig[] = [
    {
        key: 'feeling',
        shortQuestion: 'Como te sentes?',
        shortQuestionEn: 'Mindset?',
        fullQuestion: '1. Como te sentes neste momento?',
        fullQuestionEn: '1. What was your mindset at entry?',
        options: [
            { value: 'Calmo', labelEn: 'Composed', emoji: '😌', tone: 'accent' },
            { value: 'Ansioso', labelEn: 'Anxious', emoji: '😰', tone: 'warning' },
        ],
    },
    {
        key: 'followingPlan',
        shortQuestion: 'Segues o plano?',
        shortQuestionEn: 'On-plan?',
        fullQuestion: '2. Estás a seguir o teu plano de trading?',
        fullQuestionEn: '2. Did this setup follow your trading plan?',
        options: [
            { value: 'Sim', labelEn: 'Yes', emoji: '✅', tone: 'accent' },
            { value: 'Não', labelEn: 'No', emoji: '❌', tone: 'danger' },
        ],
    },
    {
        key: 'entryDriver',
        shortQuestion: 'Estratégia ou impulso?',
        shortQuestionEn: 'Playbook vs Impulse?',
        fullQuestion: '3. Estás a operar por estratégia ou por impulso?',
        fullQuestionEn: '3. Was this driven by your playbook or impulse?',
        options: [
            { value: 'Estratégia', labelEn: 'Playbook', emoji: '🎯', tone: 'accent' },
            { value: 'Impulso', labelEn: 'Impulse', emoji: '⚡', tone: 'danger' },
        ],
    },
    {
        key: 'riskComfort',
        shortQuestion: 'Confortável c/ risco?',
        shortQuestionEn: 'Risk sizing OK?',
        fullQuestion: '4. Estás confortável com o risco desta operação?',
        fullQuestionEn: '4. Were you comfortable with the position sizing / risk?',
        options: [
            { value: 'Sim', labelEn: 'Yes', emoji: '👍', tone: 'accent' },
            { value: 'Não', labelEn: 'No', emoji: '👎', tone: 'danger' },
        ],
    },
];

export interface TradeNotePayload {
    id: string | null;
    tradeId: string;
    content: string;
    screenshotUrl: string | null;
    screenshots: string[];
    setup: string | null;
    mistakes: string | null;
    lessons: string | null;
    rating: number;
    psychCheck?: TradePsychCheck;
    updatedAt?: string;
}

export interface JournalTradeRow {
    id: string;
    ticket: string;
    accountId: string;
    accountName: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    status: 'OPEN' | 'CLOSED';
    openTime: string | null;
    closeTime: string | null;
    dateKey: string;
    openPrice: number;
    closePrice: number;
    avgBuy: number;
    avgSell: number;
    volume: number;
    grossPnl: number;
    netPnl: number;
    pnlPct: number | null;
    commission: number;
    swap: number;
    mfe: number | null;
    mae: number | null;
    setup: string | null;
    rating: number;
    behavioralMl?: TradeBehaviorMlInfo | null;
    behavioralFeedback?: TradeBehaviorFeedbackInfo | null;
    tradeNote: TradeNotePayload | null;
}

export interface DailyJournalBlock {
    date: string; // YYYY-MM-DD
    metrics: DailyJournalMetrics;
    note: DailyNotePayload | null;
    trades: JournalTradeRow[];
}

export interface GeneralNoteItem {
    id: string;
    title: string;
    category: GeneralNoteCategory | string;
    content: string;
    images: string[];
    pinned: boolean;
    isTemplate: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface NoteTemplateItem {
    id: string;
    title: string;
    titleEn?: string;
    content: string;
    contentEn?: string;
    isBuiltIn?: boolean;
}

export const GENERAL_CATEGORY_META: Record<
    GeneralNoteCategory,
    { label: string; labelEn: string; badgeClass: string }
> = {
    PLAYBOOK: {
        label: 'Playbook',
        labelEn: 'Playbook',
        badgeClass: 'bg-accent/15 text-accent border-accent/30',
    },
    RISK_RULES: {
        label: 'Regras de Risco',
        labelEn: 'Risk Rules',
        badgeClass: 'bg-warning/15 text-warning border-warning/30',
    },
    PSYCHOLOGY: {
        label: 'Psicologia',
        labelEn: 'Psychology',
        badgeClass: 'bg-data-1/15 text-data-1 border-data-1/30',
    },
    GENERAL: {
        label: 'Geral',
        labelEn: 'General',
        badgeClass: 'bg-surface-2 text-fg-muted border-line',
    },
};

export const DEFAULT_NOTE_TEMPLATES: NoteTemplateItem[] = [
    {
        id: 'builtin-daily-debrief',
        title: 'Debriefing Diário (Psicológico & Macro)',
        titleEn: 'Daily Session Debrief (Macro & Mindset)',
        isBuiltIn: true,
        content: `<h2>Contexto Macroeconômico & Sessão</h2><ul><li><strong>Drivers do dia / Notícias:</strong> </li><li><strong>Estrutura & Liquidez:</strong> </li></ul><h2>Estado Psicológico & Execução</h2><ul><li><strong>Nível de foco e energia:</strong> </li><li><strong>Aderência às regras do plano:</strong> </li></ul><h2>Principais Lições & Ajustes</h2><ul><li><strong>O que repetir amanhã:</strong> </li><li><strong>O que corrigir imediatamente:</strong> </li></ul>`,
        contentEn: `<h2>Macro Context &amp; Session Flow</h2><ul><li><strong>Session drivers / High-impact news:</strong> </li><li><strong>Market structure &amp; liquidity pools:</strong> </li></ul><h2>Mindset &amp; Execution Discipline</h2><ul><li><strong>Focus and energy baseline:</strong> </li><li><strong>Plan &amp; risk rule adherence:</strong> </li></ul><h2>Key Takeaways &amp; Adjustments</h2><ul><li><strong>What to repeat tomorrow:</strong> </li><li><strong>Immediate adjustments:</strong> </li></ul>`,
    },
    {
        id: 'builtin-pre-market',
        title: 'Plano Pré-Mercado',
        titleEn: 'Pre-Market Gameplan',
        isBuiltIn: true,
        content: `<h2>Preparação Pré-Mercado</h2><ul><li><strong>Ativos em foco:</strong> </li><li><strong>Viés Direcional (HTF / Intraday):</strong> </li><li><strong>Níveis-chave (PDH / PDL / Order Blocks):</strong> </li><li><strong>Eventos Econômicos de Alto Impacto:</strong> </li><li><strong>Risco Máximo Diário / Stop de Operações:</strong> </li></ul>`,
        contentEn: `<h2>Pre-Market Preparation</h2><ul><li><strong>Watchlist instruments:</strong> </li><li><strong>Directional Bias (HTF / Intraday):</strong> </li><li><strong>Key levels (PDH / PDL / Liquidity / OB):</strong> </li><li><strong>High-impact economic releases:</strong> </li><li><strong>Max daily loss / hard stop rule:</strong> </li></ul>`,
    },
    {
        id: 'builtin-trade-review',
        title: 'Revisão Técnica de Trade (MFE / MAE)',
        titleEn: 'Execution Review (MFE / MAE)',
        isBuiltIn: true,
        content: `<h2>Tese Técnica da Operação</h2><ul><li><strong>Setup / Gatilho de Entrada:</strong> </li><li><strong>Confluências a favor:</strong> </li></ul><h2>Gestão de Risco (MFE vs MAE)</h2><ul><li><strong>Calor suportado (MAE) foi dentro do esperado?</strong> </li><li><strong>Captura de excursão favorável (MFE):</strong> </li></ul><h2>Veredito Final</h2><ul><li><strong>Nota de execução:</strong> </li><li><strong>Aprendizado técnico:</strong> </li></ul>`,
        contentEn: `<h2>Execution Thesis</h2><ul><li><strong>Setup / Entry trigger:</strong> </li><li><strong>Aligned confluences:</strong> </li></ul><h2>Risk Excursion (MFE vs MAE)</h2><ul><li><strong>Was adverse excursion (MAE) within stop tolerance?</strong> </li><li><strong>Favorable excursion (MFE) capture efficiency:</strong> </li></ul><h2>Post-Trade Verdict</h2><ul><li><strong>Execution grade:</strong> </li><li><strong>Technical takeaway:</strong> </li></ul>`,
    },
    {
        id: 'builtin-trading-plan',
        title: 'Regras Inegociáveis do Plano',
        titleEn: 'Non-Negotiable Desk Rules',
        isBuiltIn: true,
        content: `<h2>Regras de Ouro Operacionais</h2><ol><li><strong>Risco máximo por operação:</strong> Nunca exceder o risco definido por trade.</li><li><strong>Limite de perdas diário:</strong> Encerrar a plataforma ao atingir o drawdown diário máximo.</li><li><strong>Qualidade A+:</strong> Operar apenas setups validados com confluência clara de estrutura e sessão.</li><li><strong>Protocolo Anti-Tilt:</strong> Pausa obrigatória de 20 minutos após 2 stops consecutivos.</li></ol>`,
        contentEn: `<h2>Desk Guardrails</h2><ol><li><strong>Max risk per trade:</strong> Never exceed predefined R-risk sizing.</li><li><strong>Daily drawdown cap:</strong> Flatten and lock terminal upon reaching daily DD limit.</li><li><strong>A+ Setup selection:</strong> Execute only validated playbook setups with clean structure and session timing.</li><li><strong>Anti-Tilt cooldown:</strong> Mandatory 20-minute step-away after 2 consecutive stop-outs.</li></ol>`,
    },
];

const MONTHS_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_LONG = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatJournalBlockDate(dateKey: string): string {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '—';
    const [y, m, d] = dateKey.split('-').map(Number);
    const month = MONTHS_SHORT[(m || 1) - 1] || 'Jan';
    return `${month} ${d}, ${y}`;
}

export function formatJournalFullDate(dateKey: string): string {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '—';
    const [y, m, d] = dateKey.split('-').map(Number);
    const month = MONTHS_LONG[(m || 1) - 1] || 'January';
    return `${month} ${d}, ${y}`;
}

export function formatTimeShort(iso?: string | null): string {
    return formatTradeTime(iso, { includeSeconds: true, fallback: '—' });
}

export function formatSignedCurrency(val: number | null | undefined): string {
    if (val === null || val === undefined || !Number.isFinite(val)) return '—';
    const abs = Math.abs(val).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (val > 0.004) return `+$${abs}`;
    if (val < -0.004) return `-$${abs}`;
    return `$0.00`;
}

export function formatCurrencyPlain(val: number | null | undefined): string {
    if (val === null || val === undefined || !Number.isFinite(val)) return '—';
    return `$${Math.abs(val).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export type JournalImageSlotKind = 'before' | 'after' | 'extra';

export interface JournalImageSlots {
    before: string | null;
    after: string | null;
    extras: string[];
}

const SLOT_HASH_RE = /#(antes|depois|extra)$/i;

export function cleanJournalImageUrl(url?: string | null): string {
    if (!url) return '';
    return String(url).trim().replace(SLOT_HASH_RE, '');
}

export function parseJournalImages(images?: (string | null | undefined)[] | null): JournalImageSlots {
    let before: string | null = null;
    let after: string | null = null;
    const extras: string[] = [];
    const untagged: string[] = [];

    if (!Array.isArray(images)) {
        return { before, after, extras };
    }

    for (const raw of images) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const match = trimmed.match(SLOT_HASH_RE);
        const clean = trimmed.replace(SLOT_HASH_RE, '');
        if (!clean) continue;

        if (match) {
            const tag = match[1].toLowerCase();
            if (tag === 'antes') {
                if (!before) before = clean;
                else extras.push(clean);
            } else if (tag === 'depois') {
                if (!after) after = clean;
                else extras.push(clean);
            } else {
                extras.push(clean);
            }
        } else {
            untagged.push(clean);
        }
    }

    for (const u of untagged) {
        if (!before) {
            before = u;
        } else if (!after) {
            after = u;
        } else {
            extras.push(u);
        }
    }

    return { before, after, extras };
}

export function serializeJournalImages(slots: JournalImageSlots): string[] {
    const out: string[] = [];
    const beforeClean = cleanJournalImageUrl(slots.before);
    const afterClean = cleanJournalImageUrl(slots.after);

    if (beforeClean) {
        out.push(`${beforeClean}#antes`);
    }
    if (afterClean) {
        out.push(`${afterClean}#depois`);
    }
    for (const ex of slots.extras) {
        const exClean = cleanJournalImageUrl(ex);
        if (exClean) {
            out.push(`${exClean}#extra`);
        }
    }
    return out.slice(0, 20);
}

export function stripHtmlPreview(html?: string | null, maxLen = 90): string {
    if (!html) return '';
    const plain = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (plain.length <= maxLen) return plain;
    return `${plain.slice(0, maxLen).trim()}…`;
}

export function computeClientDailyMetrics(dayTrades: JournalTradeRow[]): DailyJournalMetrics {
    const totalTrades = dayTrades.length;
    const closedList = dayTrades.filter((t) => t.status === 'CLOSED');
    const closedTrades = closedList.length;

    let totalCommissions = 0;
    let grossPnl = 0;
    let netPnl = 0;
    let grossProfit = 0;
    let grossLossAbs = 0;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;

    const mfeValues: number[] = [];
    const maeValues: number[] = [];

    for (const t of dayTrades) {
        totalCommissions += Math.abs(Number(t.commission) || 0);
        grossPnl += Number(t.grossPnl) || 0;
        netPnl += Number(t.netPnl) || 0;

        if (t.mfe !== null && t.mfe !== undefined && Number.isFinite(Number(t.mfe))) {
            mfeValues.push(Math.abs(Number(t.mfe)));
        }
        if (t.mae !== null && t.mae !== undefined && Number.isFinite(Number(t.mae))) {
            maeValues.push(Math.abs(Number(t.mae)));
        }
    }

    for (const t of closedList) {
        const pnl = Number(t.netPnl) || 0;
        if (pnl > 0.001) {
            wins += 1;
            grossProfit += pnl;
        } else if (pnl < -0.001) {
            losses += 1;
            grossLossAbs += Math.abs(pnl);
        } else {
            breakevens += 1;
        }
    }

    const winRate =
        closedTrades > 0 ? Number(((wins / closedTrades) * 100).toFixed(1)) : null;

    let profitFactor: number | null = null;
    if (closedTrades > 0) {
        if (grossLossAbs > 0) {
            profitFactor = Number((grossProfit / grossLossAbs).toFixed(2));
        } else if (grossProfit > 0) {
            profitFactor = 99.99;
        } else {
            profitFactor = 0;
        }
    }

    const avgMfe =
        mfeValues.length > 0
            ? Number((mfeValues.reduce((s, v) => s + v, 0) / mfeValues.length).toFixed(2))
            : null;
    const maxMfe = mfeValues.length > 0 ? Number(Math.max(...mfeValues).toFixed(2)) : null;

    const avgMae =
        maeValues.length > 0
            ? Number((maeValues.reduce((s, v) => s + v, 0) / maeValues.length).toFixed(2))
            : null;
    const maxMae = maeValues.length > 0 ? Number(Math.max(...maeValues).toFixed(2)) : null;

    return {
        totalTrades,
        closedTrades,
        wins,
        losses,
        breakevens,
        totalCommissions: Number(totalCommissions.toFixed(2)),
        grossPnl: Number(grossPnl.toFixed(2)),
        netPnl: Number(netPnl.toFixed(2)),
        winRate,
        profitFactor,
        avgMfe,
        maxMfe,
        avgMae,
        maxMae,
    };
}
