import { AiChatMessageEntity } from './ai-chat.entity';
import { DeterministicSqlToolsBundle } from './ai-deterministic-sql-tools.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import {
    AiPromptSystemService,
    GeminiAnalyticalBriefInput,
} from './ai-prompt-system.service';
import { RagRetrievedContext } from './ai-rag.service';
import { AiRouterService } from './ai-router.service';
import { TraderPerformanceSnapshot } from './ai-trade-analyzer.service';

const makeRichSnapshot = (
    overrides: Partial<TraderPerformanceSnapshot> = {}
): TraderPerformanceSnapshot => ({
    accountLabel: 'MT5 Deriv Real',
    currency: 'USD',
    totalTrades: 92,
    openPositionsCount: 0,
    openFloatingPnl: 0,
    wins: 74,
    losses: 18,
    breakevens: 0,
    winRate: 80.4,
    grossPnl: 23100,
    totalCommissions: -457.4,
    netPnl: 22642.6,
    profitFactor: 12.74,
    avgWin: 332.05,
    avgLoss: -113.49,
    payoffRatio: 2.93,
    expectancy: 246.12,
    maxWin: 1450,
    maxLoss: -380,
    maxDrawdown: 640,
    slDisciplinePct: 78,
    currentStreak: { type: 'WIN', count: 3 },
    maxLossStreak: 3,
    maxWinStreak: 11,
    today: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
    recent7d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
    recent14d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
    recent30d: { trades: 0, wins: 0, netPnl: 0, winRate: 0, profitFactor: 0 },
    avgMfe: 120,
    avgMae: 10,
    bestSymbol: {
        symbol: 'XAUUSD',
        trades: 51,
        wins: 45,
        netPnl: 18847.7,
        winRate: 88.2,
    },
    worstSymbol: {
        symbol: 'USDJPY',
        trades: 29,
        wins: 17,
        netPnl: -412.3,
        winRate: 58.6,
    },
    topSymbols: [
        { symbol: 'XAUUSD', trades: 51, wins: 45, netPnl: 18847.7, winRate: 88.2 },
        { symbol: 'EURUSD', trades: 29, wins: 27, netPnl: 4207.2, winRate: 93.1 },
    ],
    allSymbols: [
        { symbol: 'XAUUSD', trades: 51, wins: 45, netPnl: 18847.7, winRate: 88.2 },
        { symbol: 'EURUSD', trades: 29, wins: 27, netPnl: 4207.2, winRate: 93.1 },
        { symbol: 'USDJPY', trades: 29, wins: 17, netPnl: -412.3, winRate: 58.6 },
    ],
    bestSession: {
        session: 'Londres',
        trades: 41,
        wins: 38,
        netPnl: 12500,
        winRate: 92.7,
    },
    worstSession: {
        session: 'Nova Iorque',
        trades: 22,
        wins: 14,
        netPnl: 1200,
        winRate: 63.6,
    },
    allSessions: [
        { session: 'Londres', trades: 41, wins: 38, netPnl: 12500, winRate: 92.7 },
        { session: 'Ásia', trades: 29, wins: 27, netPnl: 8942.6, winRate: 93.1 },
        { session: 'Nova Iorque', trades: 22, wins: 14, netPnl: 1200, winRate: 63.6 },
    ],
    topSetups: [{ setup: 'Liquidity Sweep M15', trades: 48, netPnl: 15200 }],
    topLessons: [{ lesson: 'Esperar fechamento M15 antes da entrada', count: 5 }],
    torexScore: 84,
    radarMetrics: {
        consistency: 78,
        riskManagement: 62,
        discipline: 58,
        profitability: 94,
        winRate: 80,
        profitFactorScore: 95,
    },
    healthScore: 68,
    unresolvedAlertsCount: 8,
    activeAlerts: [
        {
            type: 'TILT',
            severity: 'CRITICAL',
            title: 'Tilt detectado após 2 stops consecutivos',
        },
        {
            type: 'EXTENDED_STOP',
            severity: 'HIGH',
            title: 'Stop Loss Estendido em entrada emocional',
        },
    ],
    dailyLossLimit: 500,
    dailyLossLimitRemaining: 500,
    overtradingDays: [{ date: '2026-08-25', trades: 14, netPnl: -290 }],
    activeDaysCount: 30,
    dailyNotesCount: 3,
    journalCoveragePct: 10,
    adversePsychSummary: { days: 4, netPnl: -380 },
    tradeNotesCount: 9,
    savedPlanRules: [],
    recentTradesSample: [],
    ...overrides,
});

const makeRichSqlBundle = (): DeterministicSqlToolsBundle => ({
    accountScope: {
        accountLabel: 'MT5 Deriv Real',
        currency: 'USD',
        accountCount: 1,
    },
    toolsExecuted: [
        'window_summary',
        'directional_split',
        'target_symbols_breakdown',
        'top_winning_losing_symbols',
        'session_matrix',
        'weekday_matrix',
        'setup_matrix',
        'overtrading_days',
    ],
    windowSummary: {
        timeframeHint: 'all_history',
        sinceIso: null,
        totalTrades: 92,
        wins: 74,
        losses: 18,
        breakevens: 0,
        winRate: 80.4,
        grossPnl: 23100,
        commissionsAndFees: -457.4,
        netPnl: 22642.6,
        profitFactor: 12.74,
        avgWin: 332.05,
        avgLoss: -113.49,
        payoffRatio: 2.93,
        expectancy: 246.12,
        maxWin: 1450,
        maxLoss: -380,
        slUsagePct: 78,
        avgWinHoldMinutes: 55,
        avgLossHoldMinutes: 82,
        avgMfe: 120,
        avgMae: 10,
    },
    directionalSplit: [
        { side: 'BUY', trades: 58, wins: 49, winRate: 84.5, netPnl: 16200 },
        { side: 'SELL', trades: 34, wins: 25, winRate: 73.5, netPnl: 6442.6 },
    ],
    targetSymbolsBreakdown: [
        {
            symbol: 'XAUUSD',
            status: 'OPERATED_IN_WINDOW',
            trades: 51,
            wins: 45,
            winRate: 88.2,
            netPnl: 18847.7,
        },
        {
            symbol: 'USDJPY',
            status: 'OPERATED_IN_WINDOW',
            trades: 29,
            wins: 17,
            winRate: 58.6,
            netPnl: -412.3,
        },
    ],
    topWinningSymbols: [
        {
            symbol: 'XAUUSD',
            status: 'OPERATED_IN_WINDOW',
            trades: 51,
            wins: 45,
            winRate: 88.2,
            netPnl: 18847.7,
        },
    ],
    topLosingSymbols: [
        {
            symbol: 'USDJPY',
            status: 'OPERATED_IN_WINDOW',
            trades: 29,
            wins: 17,
            winRate: 58.6,
            netPnl: -412.3,
        },
    ],
    sessionMatrix: [
        { session: 'Londres', trades: 41, wins: 38, winRate: 92.7, netPnl: 12500 },
        { session: 'Ásia', trades: 29, wins: 27, winRate: 93.1, netPnl: 8942.6 },
    ],
    weekdayMatrix: [
        {
            weekdayIndex: 2,
            weekdayLabel: 'Ter',
            trades: 25,
            wins: 22,
            winRate: 88,
            netPnl: 6500,
        },
    ],
    setupMatrix: [
        {
            setup: 'Liquidity Sweep M15',
            trades: 48,
            wins: 42,
            winRate: 87.5,
            netPnl: 15200,
        },
    ],
    overtradingDays: [{ date: '2026-08-25', trades: 14, netPnl: -290 }],
    backtestingIncluded: false,
    backtestingSummary: null,
});

const makeRichRagContext = (): RagRetrievedContext => ({
    sourcesUsed: ['TRADE_NOTE', 'DAILY_NOTE', 'PLAYBOOK', 'GENERAL_NOTE'],
    syncedChunks: 4,
    chunks: [
        {
            id: 'c-1',
            sourceType: 'DAILY_NOTE',
            sourceId: 'dn-1',
            chunkIndex: 0,
            accountId: 'acc-1',
            title: 'Check-in 2026-08-25',
            content: 'Ansioso após dois stops seguidos.',
            similarity: 0.91,
            metadata: {},
        },
        {
            id: 'c-2',
            sourceType: 'GENERAL_NOTE',
            sourceId: 'gn-1',
            chunkIndex: 0,
            accountId: 'acc-1',
            title: 'Tilt crítico',
            content: 'Sequência impulsiva fora do horário.',
            similarity: 0.88,
            metadata: {},
        },
        {
            id: 'c-3',
            sourceType: 'TRADE_NOTE',
            sourceId: 'tn-1',
            chunkIndex: 0,
            accountId: 'acc-1',
            title: 'Entrada XAUUSD',
            content: 'Stop técnico respeitado.',
            similarity: 0.85,
            metadata: {},
        },
        {
            id: 'c-4',
            sourceType: 'PLAYBOOK',
            sourceId: 'pb-1',
            chunkIndex: 0,
            accountId: 'acc-1',
            title: 'Regra de Gestão',
            content: 'Máximo 2 trades por sessão.',
            similarity: 0.84,
            metadata: {},
        },
    ],
});

const extractDataSections = (systemPrompt: string): string => {
    const tags = [
        'mapa_plataforma',
        'dados_verificados_conta',
        'ferramentas_sql_deterministicas',
        'contexto_rag_qualitativo',
    ];
    return tags
        .map((tag) => {
            const match = systemPrompt.match(
                new RegExp(`^<${tag}>\\r?\\n([\\s\\S]*?)\\r?\\n<\\/${tag}>$`, 'im')
            );
            return match ? match[0] : '';
        })
        .filter(Boolean)
        .join('\n');
};

describe('Phase 7: Selective Scoping, Flash-Coach Brevity, Anti-Echo & Clean Links', () => {
    let promptSystem: AiPromptSystemService;
    let knowledgeBase: AiKnowledgeBaseService;

    beforeEach(() => {
        promptSystem = new AiPromptSystemService();
        knowledgeBase = new AiKnowledgeBaseService();
    });

    it('1. PLAN_DISCIPLINE omite breakdown de ativos (USDJPY), sessões e /calendar, mantendo foco em Playbook/Diário/Alertas', () => {
        const snapshot = makeRichSnapshot();
        const sqlToolsBundle = makeRichSqlBundle();
        const ragContext = makeRichRagContext();
        const question = 'Como posso melhorar? — Foco: Controlo emocional e diário';
        const inspection = promptSystem.inspectAndClassifyInput(question, 250, 'pt');

        const handoff: GeminiAnalyticalBriefInput = {
            formalizedQuestion: question,
            analyticalObjective: 'Auditar disciplina, diário e controle emocional.',
            subIntent: 'PLAN_DISCIPLINE',
            targetSymbols: [],
            timeframeHint: 'all_history',
            includeJournalNotes: true,
            includePlaybookRules: true,
            includeBacktesting: false,
            focusMetrics: ['journal_coverage', 'playbook_rules', 'psych_alerts'],
            strictFocusTopic: 'Controlo emocional e diário',
        };

        const compiled = promptSystem.compileGeminiHandoffPrompt({
            userName: 'derciomatsope9',
            inspection,
            handoff,
            snapshot,
            sqlToolsBundle,
            ragContext,
            platformMapSummary: knowledgeBase.getPlatformContextSummary('pt'),
            locale: 'pt',
        });

        const scopedData = extractDataSections(compiled.systemPrompt);
        expect(scopedData).not.toContain('USDJPY');
        expect(scopedData).not.toContain('92.7%');
        expect(scopedData).not.toContain('/calendar');
        expect(compiled.userTaskPrompt).toContain(
            'FOCO EXCLUSIVO ESCOLHIDO PELO TRADER: "Controlo emocional e diário"'
        );
        expect(scopedData.toLowerCase()).toContain('playbook');
        expect(scopedData).toContain('Tilt');
        expect(scopedData).toContain('10');
    });

    it('2. EDGE_STRENGTHS omite regras do Playbook, cobertura de diário e alertas de Tilt, mantendo Edge, Payoff e MFE/MAE', () => {
        const snapshot = makeRichSnapshot();
        const sqlToolsBundle = makeRichSqlBundle();
        const ragContext = makeRichRagContext();
        const question = 'Qual é o meu Edge?';
        const inspection = promptSystem.inspectAndClassifyInput(question, 250, 'pt');

        const handoff: GeminiAnalyticalBriefInput = {
            formalizedQuestion: question,
            analyticalObjective: 'Calcular e sintetizar o Edge estatístico da conta.',
            subIntent: 'EDGE_STRENGTHS',
            targetSymbols: [],
            timeframeHint: 'all_history',
            includeJournalNotes: false,
            includePlaybookRules: false,
            includeBacktesting: false,
            focusMetrics: ['expectancy', 'payoff', 'winrate', 'profit_factor', 'mfe_mae'],
        };

        const compiled = promptSystem.compileGeminiHandoffPrompt({
            userName: 'derciomatsope9',
            inspection,
            handoff,
            snapshot,
            sqlToolsBundle,
            ragContext,
            platformMapSummary: knowledgeBase.getPlatformContextSummary('pt'),
            locale: 'pt',
        });

        const scopedData = extractDataSections(compiled.systemPrompt);
        expect(scopedData).not.toContain('Tilt');
        expect(scopedData.toLowerCase()).not.toContain('playbook');
        expect(scopedData).not.toContain('journalCoverage');
        expect(scopedData).not.toContain('savedPlanRules');
        expect(scopedData).toContain('246.12');
        expect(scopedData).toContain('2.93');
        expect(scopedData).toContain('XAUUSD');
    });

    it('3. timeframeHint = all_history omite recorteTemporalFoco e janelas zeradas recent14d/recent30d', () => {
        const snapshot = makeRichSnapshot();
        const sqlToolsBundle = makeRichSqlBundle();
        const ragContext = makeRichRagContext();
        const question = 'Como está minha performance geral?';
        const inspection = promptSystem.inspectAndClassifyInput(question, 250, 'pt');

        const handoff: GeminiAnalyticalBriefInput = {
            formalizedQuestion: question,
            analyticalObjective: 'Resumo objetivo de performance.',
            subIntent: 'STATUS_OVERVIEW',
            targetSymbols: [],
            timeframeHint: 'all_history',
            includeJournalNotes: true,
            includePlaybookRules: true,
            includeBacktesting: false,
            focusMetrics: ['net_pnl', 'winrate', 'payoff'],
        };

        const compiled = promptSystem.compileGeminiHandoffPrompt({
            userName: 'Dercio',
            inspection,
            handoff,
            snapshot,
            sqlToolsBundle,
            ragContext,
            platformMapSummary: knowledgeBase.getPlatformContextSummary('pt'),
            locale: 'pt',
        });

        expect(compiled.systemPrompt).not.toContain('recorteTemporalFoco');
        expect(compiled.systemPrompt).not.toContain('recent14d');
        expect(compiled.systemPrompt).not.toContain('recent30d');
    });

    it('4. Grill-Me: "Como posso melhorar?" -> "Controlo emocional e diário" força subIntent = PLAN_DISCIPLINE e strictFocusTopic', async () => {
        const mockLlmProvider: jest.Mocked<Partial<AiLlmProviderService>> = {
            getDualEngineStatus: jest.fn().mockReturnValue({
                qwenEnabled: true,
                qwenModel: 'qwen-plus',
                qwenEndpoint:
                    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
                geminiEnabled: true,
                geminiModel: 'gemini-2.5-flash',
                anyEnabled: true,
            }),
            generateRouterJson: jest.fn().mockResolvedValue({
                text: JSON.stringify({
                    decision: 'ESCALATE_TO_GEMINI',
                    intent: 'improvement_plan',
                    reply: '',
                    handoff: {
                        formalizedQuestion:
                            'Como posso melhorar com foco em controlo emocional e diário?',
                        analyticalObjective:
                            'Diagnosticar disciplina e diário do trader.',
                        subIntent: 'IMPROVEMENT_PLAN',
                        targetSymbols: [],
                        timeframeHint: 'all_history',
                        includeJournalNotes: true,
                        includePlaybookRules: true,
                        focusMetrics: ['net_pnl', 'winrate'],
                    },
                }),
                providerUsed: 'qwen_router',
                modelUsed: 'qwen-plus',
                totalTokens: 150,
                latencyMs: 240,
            }),
        };

        const router = new AiRouterService(
            mockLlmProvider as unknown as AiLlmProviderService,
            knowledgeBase,
            promptSystem
        );

        const previousAssistantMsg: Partial<AiChatMessageEntity> = {
            id: 'msg-grill-1',
            role: 'assistant',
            content:
                'Para ajudar com precisão, onde sente maior desafio hoje: controlo emocional, regras ou gestão?',
            metadata: {
                grillMeState: {
                    active: true,
                    originalQuestion: 'Como posso melhorar?',
                    clarificationAsked:
                        'Para ajudar com precisão, onde sente maior desafio hoje?',
                    missingAspects: ['focus'],
                    turnCount: 1,
                    createdAtIso: new Date().toISOString(),
                },
            },
        };

        const answer = 'Controlo emocional e diário';
        const inspection = promptSystem.inspectAndClassifyInput(answer, 250, 'pt');

        const res = await router.routeUserMessage({
            userName: 'derciomatsope9',
            trimmedQuestion: answer,
            inspection,
            previousMessages: [previousAssistantMsg as AiChatMessageEntity],
            accountHint: {
                accountLabel: 'MT5 Deriv Real',
                hasData: true,
                totalTrades: 92,
                openPositionsCount: 0,
                topSymbols: ['XAUUSD', 'EURUSD'],
                hasDailyNotes: true,
                hasPlaybookRules: false,
            },
            locale: 'pt',
        });

        expect(res.decision).toBe('ESCALATE_TO_GEMINI');
        expect(res.handoff?.subIntent).toBe('PLAN_DISCIPLINE');
        expect(res.handoff?.strictFocusTopic).toBe('Controlo emocional e diário');
        expect(res.handoff?.includeJournalNotes).toBe(true);
        expect(res.handoff?.includePlaybookRules).toBe(true);
    });

    it('5. Injeta <anti_repeticao_sessao> quando turno anterior alertou sobre Playbook/10%/Tilt e subIntent != PLAN_DISCIPLINE', () => {
        const snapshot = makeRichSnapshot();
        const sqlToolsBundle = makeRichSqlBundle();
        const ragContext = makeRichRagContext();
        const previousReplies = [
            'Sua cobertura no diário é de apenas 10%, não há regras escritas no Playbook e há alerta de Tilt.',
        ];

        const edgeHandoff: GeminiAnalyticalBriefInput = {
            formalizedQuestion: 'Qual é o meu Edge?',
            analyticalObjective: 'Auditar Edge estatístico.',
            subIntent: 'EDGE_STRENGTHS',
            targetSymbols: [],
            timeframeHint: 'all_history',
            includeJournalNotes: false,
            includePlaybookRules: false,
            focusMetrics: ['expectancy', 'payoff'],
        };

        const edgePrompt = promptSystem.compileGeminiHandoffPrompt({
            userName: 'Dercio',
            inspection: promptSystem.inspectAndClassifyInput('Qual é o meu Edge?', 250, 'pt'),
            handoff: edgeHandoff,
            snapshot,
            sqlToolsBundle,
            ragContext,
            platformMapSummary: knowledgeBase.getPlatformContextSummary('pt'),
            recentAssistantReplies: previousReplies,
            locale: 'pt',
        });

        expect(edgePrompt.systemPrompt).toContain('<anti_repeticao_sessao>');

        const disciplineHandoff: GeminiAnalyticalBriefInput = {
            ...edgeHandoff,
            formalizedQuestion: 'Estou seguindo meu plano?',
            subIntent: 'PLAN_DISCIPLINE',
            includeJournalNotes: true,
            includePlaybookRules: true,
        };

        const disciplinePrompt = promptSystem.compileGeminiHandoffPrompt({
            userName: 'Dercio',
            inspection: promptSystem.inspectAndClassifyInput(
                'Estou seguindo meu plano?',
                250,
                'pt'
            ),
            handoff: disciplineHandoff,
            snapshot,
            sqlToolsBundle,
            ragContext,
            platformMapSummary: knowledgeBase.getPlatformContextSummary('pt'),
            recentAssistantReplies: previousReplies,
            locale: 'pt',
        });

        expect(disciplinePrompt.systemPrompt).not.toContain(
            '<anti_repeticao_sessao>'
        );
    });

    it('6. verifyModelOutput converte Markdown de localhost, deduplica /journal para 1x, remove preâmbulo burocrático e preserva resolveRouteActionsFromText', () => {
        const raw =
            'Com base na auditoria dos seus dados, sua cobertura está em 10% sem regras no [/journal](http://localhost:3000/journal). ' +
            'Registre seus trades em [/journal](http://localhost:3000/journal) e revise o plano em [/journal](http://localhost:3000/journal). ' +
            'Aproveite também para consolidar suas notas após cada sessão operacional visando proteção de capital e consistência.\n' +
            '*Nota: Recomendo iniciar em [/journal](http://localhost:3000/journal) imediatamente.*';

        const cleaned = promptSystem.verifyModelOutput(raw, 'pt')!;

        expect(cleaned).not.toContain('http://localhost:3000');
        expect(cleaned).not.toContain('[/journal]');
        expect(cleaned).not.toMatch(/^Com base na auditoria dos seus dados/i);
        expect(cleaned).not.toContain('*Nota:');
        expect((cleaned.match(/\/journal\b/gi) || []).length).toBe(1);
        expect(cleaned).toContain('**Diário**');

        const actions = knowledgeBase.resolveRouteActionsFromText(cleaned, 'pt');
        expect(actions).toEqual(
            expect.arrayContaining([expect.objectContaining({ route: '/journal' })])
        );
    });

    it('7. formatTraderDisplayName rejeita handle técnico "derciomatsope9" e saudação Layer 0 omite username técnico', async () => {
        expect(promptSystem.formatTraderDisplayName('derciomatsope9')).toBeNull();
        expect(promptSystem.formatTraderDisplayName('Dercio Matsope')).toBe('Dercio');
        expect(promptSystem.formatTraderDisplayName('trader')).toBeNull();

        const mockLlmProvider: jest.Mocked<Partial<AiLlmProviderService>> = {
            getDualEngineStatus: jest.fn().mockReturnValue({
                qwenEnabled: true,
                geminiEnabled: true,
                anyEnabled: true,
            }),
            generateRouterJson: jest.fn(),
        };

        const router = new AiRouterService(
            mockLlmProvider as unknown as AiLlmProviderService,
            knowledgeBase,
            promptSystem
        );

        const greeting = 'oi, bom dia tudo bem';
        const inspection = promptSystem.inspectAndClassifyInput(greeting, 250, 'pt');

        const res = await router.routeUserMessage({
            userName: 'derciomatsope9',
            trimmedQuestion: greeting,
            inspection,
            previousMessages: [],
            accountHint: {
                accountLabel: 'MT5',
                hasData: true,
                totalTrades: 10,
                openPositionsCount: 0,
                topSymbols: ['XAUUSD'],
                hasDailyNotes: false,
                hasPlaybookRules: false,
            },
            locale: 'pt',
        });

        expect(res.decision).toBe('DIRECT_REPLY');
        expect(res.reply).not.toContain('derciomatsope9');
        expect(res.reply).toContain('Torex AI');
    });
});
