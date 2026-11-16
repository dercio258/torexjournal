import api from '../../api';

export interface ClientAiMetricCard {
    label: string;
    value: string;
    tone?: 'positive' | 'negative' | 'neutral';
    subtext?: string;
}

export interface ClientAiActionLink {
    label: string;
    route: string;
}

export const TOREX_AI_SUPPORT_FALLBACK =
    'Não consigo ajudar-lhe neste momento, entre em contacto com o suporte oficial pelos contactos +258858923752 info@torexjournal.com';

export const TOREX_AI_SUPPORT_FALLBACK_EN =
    'I am unable to assist at the moment. Please contact official support at +258858923752 or info@torexjournal.com.';

const CLIENT_GREETING_PHRASES = [
    'bom dia',
    'boa tarde',
    'boa noite',
    'tudo bem',
    'tudo bom',
    'tudo otimo',
    'tudo tranquilo',
    'tudo certo',
    'como estas',
    'como esta',
    'como vai',
    'como vais',
    'como voce esta',
    'como tu estas',
    'torex ai',
    'ai torex',
    'good morning',
    'good afternoon',
    'good evening',
    'good night',
    'how are you',
    'how are u',
    'how r u',
    'whats up',
    'what is up',
    'e ai',
];

const CLIENT_GREETING_WORDS = new Set([
    'ola',
    'oi',
    'oii',
    'oiii',
    'opa',
    'epa',
    'viva',
    'salve',
    'alo',
    'torex',
    'hi',
    'hii',
    'hello',
    'hey',
    'yo',
    'sup',
]);

const CLIENT_GREETING_COMPANIONS = new Set([
    'amigo',
    'coach',
    'brother',
    'bro',
    'mate',
    'mano',
    'chefe',
    'contigo',
    'voce',
    'tu',
    'ai',
    'hoje',
    'agora',
    'meu',
    'today',
    'there',
]);

export function isGreetingPrompt(rawText: string): boolean {
    const cleaned = String(rawText || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned || cleaned.length > 65) return false;

    let working = ` ${cleaned} `;
    let hasPhrase = false;
    for (const phrase of CLIENT_GREETING_PHRASES) {
        const rx = new RegExp(`\\s${phrase}\\s`, 'g');
        if (rx.test(working)) {
            hasPhrase = true;
            working = working.replace(rx, ' ');
        }
    }

    const tokens = working.trim().split(/\s+/).filter(Boolean);
    let hasWord = false;
    for (const tk of tokens) {
        if (CLIENT_GREETING_WORDS.has(tk)) {
            hasWord = true;
            continue;
        }
        if (CLIENT_GREETING_COMPANIONS.has(tk)) {
            continue;
        }
        return false;
    }

    return hasPhrase || hasWord;
}

export interface ClientAiCreditStatus {
    planTier: string;
    dailyLimit: number;
    creditsRemaining: number;
    creditsUsedToday: number;
    totalCreditsUsed: number;
    lastResetDate: string;
    nextResetAt: string;
    canInteract: boolean;
    maxMessageChars?: number;
}

export interface ClientAiMessageFeedback {
    rating: 1 | -1;
    reasonCode?: string | null;
    correctionNote?: string | null;
    updatedAtIso?: string;
}

export interface ClientAiMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    intent?: string | null;
    provider?: string;
    createdAt: string;
    metadata?: {
        metrics?: ClientAiMetricCard[];
        actions?: ClientAiActionLink[];
        suggestions?: string[];
        accountLabel?: string;
        creditsUsed?: number;
        tokensUsed?: number;
        memoryHitScope?: string;
        userFeedback?: ClientAiMessageFeedback | null;
        /** The server asks for a 👍/👎 on this reply (first analyst reply, then every 5th). */
        askFeedback?: boolean;
    };
}

export interface ClientAiSession {
    id: string;
    title: string;
    accountId?: string | null;
    createdAt: string;
    updatedAt: string;
}

const LOCAL_AI_STORE_KEY = 'torex_ai_local_sessions_v1';

interface LocalAiStore {
    sessions: ClientAiSession[];
    messagesBySession: Record<string, ClientAiMessage[]>;
}

export function loadLocalAiStore(): LocalAiStore {
    try {
        const raw = localStorage.getItem(LOCAL_AI_STORE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
                messagesBySession: parsed.messagesBySession || {},
            };
        }
    } catch {
        // ignore storage errors
    }
    return { sessions: [], messagesBySession: {} };
}

export function saveLocalAiStore(store: LocalAiStore) {
    try {
        localStorage.setItem(LOCAL_AI_STORE_KEY, JSON.stringify(store));
    } catch {
        // ignore storage errors
    }
}

function normalize(raw: string): string {
    return String(raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function fmtMoney(val: number): string {
    const abs = Math.abs(val).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    if (val > 0.004) return `+$${abs}`;
    if (val < -0.004) return `-$${abs}`;
    return '$0.00';
}

export async function generateClientFallbackReply(params: {
    question: string;
    userName: string;
    accountId?: string | null;
    accountLabel: string;
    locale?: 'pt' | 'en';
}): Promise<Omit<ClientAiMessage, 'id' | 'createdAt'>> {
    const isEn = params.locale === 'en';
    if (isGreetingPrompt(params.question)) {
        return {
            role: 'assistant',
            provider: 'prompt_guardrail',
            content: isEn
                ? 'Hey there! I am Torex AI, your trading performance coach. How can I help you analyze your edge today?'
                : 'Oi, tudo bem? Sou Torex AI, estou aqui para ajudar. Como posso ajudar? Diga-me.',
            metadata: {
                metrics: [],
                actions: [],
                suggestions: isEn
                    ? [
                          'How is my live performance looking?',
                          'Why am I leaking R-multiples?',
                          'What is my statistical edge?',
                          'Where can I tighten execution?',
                      ]
                    : [
                          'Como estão minhas operações atuais?',
                          'Por que estou perdendo?',
                          'Qual é o meu Edge?',
                          'Como posso melhorar?',
                      ],
            },
        };
    }

    const q = normalize(params.question);
    const firstName = params.userName?.split(' ')[0] || 'Trader';

    // 1. Perguntas de suporte da plataforma (Importação)
    if (
        /(importar|import|sincronizar|sync|conectar|connect|mt5|deriv|csv|html|xlsx|adicionar trade|add trade)/.test(q) &&
        !/(minhas operac|meu lucro|my trades|my pnl|performance)/.test(q)
    ) {
        return {
            role: 'assistant',
            provider: 'deterministic_guide',
            content: (
                isEn
                    ? [
                          '### How to import executions into Torex Journal',
                          'You have **4 direct pipelines** to sync your executions:',
                          '- **1. Direct MT5 Cloud Sync (`/add-trades/mt5-sync`)**: Connect account login, investor password, and broker server.',
                          '- **2. MT5 Expert Advisor (`/add-trades/mt5-ea`)**: Real-time automated execution telemetry directly from MetaTrader 5.',
                          '- **3. Deriv API (`/add-trades/deriv-sync`)**: Read-only API token sync for synthetic indices and FX pairs.',
                          '- **4. File Ingestion (`/add-trades/import`)**: Upload broker statements in **CSV, HTML, or Excel (.xlsx)**.',
                      ]
                    : [
                          '### Como importar suas operações no Torex Journal',
                          'Você possui **4 caminhos diretos** para trazer seus trades:',
                          '- **1. MT5 Sincronização Direta (`/add-trades/mt5-sync`)**: Conecte login, senha de investidor e servidor.',
                          '- **2. Expert Advisor MT5 (`/add-trades/mt5-ea`)**: Envio automático em tempo real direto do terminal MetaTrader 5.',
                          '- **3. Deriv API (`/add-trades/deriv-sync`)**: Sincronização via token de leitura para índices sintéticos e Forex.',
                          '- **4. Importação de Arquivo (`/add-trades/import`)**: Envie relatórios **CSV, HTML ou Excel (.xlsx)**.',
                      ]
            ).join('\n'),
            metadata: {
                actions: isEn
                    ? [
                          { label: 'Import Hub', route: '/add-trades' },
                          { label: 'Connect MT5', route: '/add-trades/mt5-sync' },
                          { label: 'Connect Deriv', route: '/add-trades/deriv-sync' },
                          { label: 'Upload CSV / HTML', route: '/add-trades/import' },
                      ]
                    : [
                          { label: 'Central de Importação', route: '/add-trades' },
                          { label: 'Conectar MT5', route: '/add-trades/mt5-sync' },
                          { label: 'Conectar Deriv', route: '/add-trades/deriv-sync' },
                          { label: 'Enviar CSV / HTML', route: '/add-trades/import' },
                      ],
                suggestions: isEn
                    ? [
                          'How do I log trade reviews in the Journal?',
                          'How is my live performance looking?',
                      ]
                    : [
                          'Como anotar minhas operações no Diário?',
                          'Como estão minhas operações atuais?',
                      ],
            },
        };
    }

    // 2. Perguntas de suporte sobre o Diário (/journal)
    if (/(como anotar|usar o diario|daily note|trade note|colocar print|screenshot|log trade|journal review)/.test(q)) {
        return {
            role: 'assistant',
            provider: 'deterministic_guide',
            content: (
                isEn
                    ? [
                          '### How to log reviews in the Journal (`/journal`)',
                          '- **Daily Notes**: Select any session block on the left to record pre/post-session mindset, macro bias, and review `Commissions`, `Trades`, `MFE`, `MAE`, `Win %`, and `P/F`.',
                          '- **Trade Notes**: Pick an execution in the ledger or *Trade Notes* tab to log **MFE ($)**, **MAE ($)**, setup tag, execution rating, and paste **BEFORE / AFTER** charts via **Ctrl+V**.',
                          '- **Playbook & Rules**: Document your trading plan rules and save custom templates via *Save as New Template*.',
                      ]
                    : [
                          '### Como anotar suas operações no Diário (`/journal`)',
                          '- **Daily Notes**: Clique no bloco cronológico do dia à esquerda para registrar seu debriefing psicológico, viés macro e revisar `Commissions`, `Trades`, `MFE`, `MAE`, `Win %` e `P/F`.',
                          '- **Trade Notes**: Selecione uma operação na tabela inferior ou na aba *Trade Notes* para informar **MFE ($)**, **MAE ($)**, setup, estrelas de execução e colar prints com **Ctrl+V**.',
                          '- **General**: Cadastre as regras do seu plano de trading e salve modelos em *Save as New Template*.',
                      ]
            ).join('\n'),
            metadata: {
                actions: isEn
                    ? [
                          { label: 'Open Journal (/journal)', route: '/journal' },
                          { label: 'View Execution Ledger', route: '/trades' },
                      ]
                    : [
                          { label: 'Abrir Diário (/journal)', route: '/journal' },
                          { label: 'Ver Trades', route: '/trades' },
                      ],
                suggestions: isEn
                    ? [
                          'Am I respecting my trading plan?',
                          'How are my closed trades and net P&L performing?',
                      ]
                    : [
                          'Estou seguindo meu plano?',
                          'Como estão minhas operações e lucros atuais?',
                      ],
            },
        };
    }

    // 3. Análise determinística real buscando /dashboard/trades
    let rawTrades: any[] = [];
    try {
        const queryParams: Record<string, string> = {};
        if (params.accountId && params.accountId !== 'all') {
            queryParams.accountId = params.accountId;
        }
        const res = await api.get('/dashboard/trades', { params: queryParams });
        if (Array.isArray(res.data)) {
            rawTrades = res.data;
        }
    } catch {
        rawTrades = [];
    }

    if (rawTrades.length === 0) {
        return {
            role: 'assistant',
            provider: 'deterministic_analytics',
            content: (
                isEn
                    ? [
                          `Hello, **${firstName}**! I checked **${params.accountLabel}** and found zero executions synced on this account yet.`,
                          '- Use the shortcuts below to connect **MT5 / Deriv** or ingest a **CSV/HTML** broker statement.',
                      ]
                    : [
                          `Olá, **${firstName}**! Verifiquei **${params.accountLabel}** e ainda não há operações registradas nesta conta.`,
                          '- Use o atalho abaixo para conectar sua conta **MT5 / Deriv** ou importar um arquivo **CSV/HTML**.',
                      ]
            ).join('\n'),
            metadata: {
                actions: isEn
                    ? [
                          { label: 'Import Executions', route: '/add-trades' },
                          { label: 'Open Journal', route: '/journal' },
                      ]
                    : [
                          { label: 'Importar Operações', route: '/add-trades' },
                          { label: 'Abrir Diário', route: '/journal' },
                      ],
                suggestions: isEn
                    ? [
                          'How do I import my trades (MT5, Deriv, or CSV)?',
                          'How do I log reviews in the Journal?',
                      ]
                    : [
                          'Como importar meus trades (MT5, Deriv ou CSV)?',
                          'Como anotar minhas operações no Diário?',
                      ],
            },
        };
    }

    let wins = 0;
    let losses = 0;
    let netPnl = 0;
    let grossWin = 0;
    let grossLossAbs = 0;
    const bySymbol = new Map<string, number>();

    for (const t of rawTrades) {
        const comm = Math.abs(Number(t.commission) || 0);
        const net =
            t.netPnl !== undefined && t.netPnl !== null
                ? Number(t.netPnl)
                : (Number(t.profit) || 0) - comm + (Number(t.swap) || 0);
        netPnl += net;
        if (net > 0.004) {
            wins += 1;
            grossWin += net;
        } else if (net < -0.004) {
            losses += 1;
            grossLossAbs += Math.abs(net);
        }
        const sym = String(t.symbol || 'ATIVO');
        bySymbol.set(sym, (bySymbol.get(sym) || 0) + net);
    }

    const total = rawTrades.length;
    const winRate = Number(((wins / total) * 100).toFixed(1));
    const pf =
        grossLossAbs > 0
            ? Number((grossWin / grossLossAbs).toFixed(2))
            : grossWin > 0
            ? 99.99
            : 0;

    const sortedSyms = Array.from(bySymbol.entries()).sort((a, b) => b[1] - a[1]);
    const bestSym = sortedSyms[0];
    const worstSym =
        sortedSyms.length > 0 && sortedSyms[sortedSyms.length - 1][1] < 0
            ? sortedSyms[sortedSyms.length - 1]
            : null;

    const pfText = isEn
        ? losses === 0 && wins > 0
            ? 'with zero losing trades recorded'
            : `at a **${pf.toFixed(2)}** Profit Factor`
        : losses === 0 && wins > 0
        ? 'sem perdas registadas'
        : `Profit Factor de **${pf.toFixed(2)}**`;

    return {
        role: 'assistant',
        provider: 'deterministic_analytics',
        content: isEn
            ? `Your current Net P&L stands at **${fmtMoney(netPnl)}**, with a **${winRate}%** win rate across **${total}** executions ${pfText}.${bestSym ? ` Your strongest edge contributor is **${bestSym[0]}** (**${fmtMoney(bestSym[1])}**).` : ''}${worstSym ? ` Watch drawdown exposure on **${worstSym[0]}** (**${fmtMoney(worstSym[1])}**).` : ''}`
            : `O seu resultado líquido atual é de **${fmtMoney(netPnl)}**, com **${winRate}%** de taxa de acerto em **${total}** operações e ${pfText}.${bestSym ? ` O principal destaque positivo é **${bestSym[0]}** (**${fmtMoney(bestSym[1])}**).` : ''}${worstSym ? ` Atenção ao ativo **${worstSym[0]}** (**${fmtMoney(worstSym[1])}**).` : ''}`,
        metadata: {
            metrics: [],
            actions: [],
            suggestions: isEn
                ? [
                      'Why am I leaking R-multiples?',
                      'What is my statistical edge?',
                      'How can I tighten execution?',
                  ]
                : [
                      'Por que estou perdendo?',
                      'Qual é o meu Edge?',
                      'Como posso melhorar?',
                  ],
        },
    };
}
