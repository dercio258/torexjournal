import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { TRADING_GLOSSARY } from './ai-trading-glossary';
import {
    AiDomainCategory,
    AiPromptSystemService,
    AnalyticalSubIntent,
} from './ai-prompt-system.service';
import { AiVectorStoreService, IntentAnchorMatch } from './ai-vector-store.service';
import { RouterTimeframeHint } from './ai-router.service';

export type SemanticRoutingConfidence =
    | 'HIGH'
    | 'AMBIGUOUS'
    | 'LOW'
    | 'BYPASSED'
    | 'UNAVAILABLE';

export interface SemanticIntentAnchorSeed {
    anchorKey: string;
    domainCategory: AiDomainCategory;
    subIntent: AnalyticalSubIntent;
    locale: 'pt' | 'en';
    phrase: string;
    metadata: Record<string, any>;
}

export interface SemanticClassificationResult {
    confidence: SemanticRoutingConfidence;
    reason: string;
    topMatch: IntentAnchorMatch | null;
    runnerUpMatch: IntentAnchorMatch | null;
    score: number;
    margin: number;
    candidates: IntentAnchorMatch[];
    thresholds: {
        high: number;
        ambiguous: number;
        minMargin: number;
    };
}

export interface AnchorSyncReport {
    totalAnchors: number;
    embeddedNow: number;
    skippedUnchanged: number;
    enabled: boolean;
}

const DEFAULT_HIGH_THRESHOLD = 0.78;
const DEFAULT_AMBIGUOUS_THRESHOLD = 0.58;
const DEFAULT_MIN_MARGIN = 0.06;

const HAND_WRITTEN_ANCHORS: SemanticIntentAnchorSeed[] = [
    // =========================================================================
    // 1. PLATFORM_KNOWLEDGE (PT + EN)
    // =========================================================================
    {
        anchorKey: 'pk_import_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Como importar meus trades do MT5, Deriv ou ficheiro CSV na plataforma?',
        metadata: { topicId: 'import_trades' },
    },
    {
        anchorKey: 'pk_import_pt_2',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Onde conecto minha corretora ou configuro a sincronização automática no Torex Journal?',
        metadata: { topicId: 'import_trades' },
    },
    {
        anchorKey: 'pk_import_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'How do I import trades from MT5, Deriv, or upload a CSV file?',
        metadata: { topicId: 'import_trades' },
    },
    {
        anchorKey: 'pk_backtest_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Como fazer backtesting e usar o replay gráfico passo a passo na plataforma?',
        metadata: { topicId: 'backtesting_replay' },
    },
    {
        anchorKey: 'pk_backtest_pt_2',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Onde crio uma estratégia e uma sessão de simulação para testar meu operacional?',
        metadata: { topicId: 'backtesting_replay' },
    },
    {
        anchorKey: 'pk_backtest_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'How do I run backtesting and launch bar-by-bar market replay?',
        metadata: { topicId: 'backtesting_replay' },
    },
    {
        anchorKey: 'pk_journal_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Como gerir meu diário de trading, registrar notas diárias, prints e regras do Playbook?',
        metadata: { topicId: 'journal_notes' },
    },
    {
        anchorKey: 'pk_journal_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'How do I manage my trading journal, trade notes, screenshots, and Playbook rules?',
        metadata: { topicId: 'journal_notes' },
    },
    {
        anchorKey: 'pk_reports_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Onde vejo relatórios avançados, filtros de período e exportação PDF ou Excel?',
        metadata: { topicId: 'reports_filters' },
    },
    {
        anchorKey: 'pk_reports_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'Where can I view reports, filter equity curves, and export data?',
        metadata: { topicId: 'reports_filters' },
    },
    {
        anchorKey: 'pk_psych_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Como registrar meu check-in emocional, sono, humor e ansiedade no diário?',
        metadata: { topicId: 'emotional_management' },
    },
    {
        anchorKey: 'pk_psych_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'How do I log emotional check-ins, sleep quality, and mood in the journal?',
        metadata: { topicId: 'emotional_management' },
    },
    {
        anchorKey: 'pk_settings_pt_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'pt',
        phrase: 'Onde acesso o calendário económico, configurações de conta, 2FA ou planos de assinatura?',
        metadata: { topicId: 'calendar_accounts_settings' },
    },
    {
        anchorKey: 'pk_settings_en_1',
        domainCategory: 'PLATFORM_KNOWLEDGE',
        subIntent: 'PLATFORM_HOWTO',
        locale: 'en',
        phrase: 'Where do I open the economic calendar, account settings, 2FA, or billing plans?',
        metadata: { topicId: 'calendar_accounts_settings' },
    },

    // =========================================================================
    // 2. TRADING_CONCEPTS (PT + EN)
    // =========================================================================
    {
        anchorKey: 'tc_pf_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'O que significa Profit Factor e como interpretar esse indicador no trading?',
        metadata: { conceptKey: 'profit_factor' },
    },
    {
        anchorKey: 'tc_pf_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What is Profit Factor in trading and what level indicates a healthy edge?',
        metadata: { conceptKey: 'profit_factor' },
    },
    {
        anchorKey: 'tc_payoff_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'Qual a diferença entre Payoff (risco/retorno) e Win Rate (taxa de acerto)?',
        metadata: { conceptKey: 'payoff_winrate' },
    },
    {
        anchorKey: 'tc_payoff_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What is the relationship between Risk-to-Reward Payoff Ratio and Win Rate?',
        metadata: { conceptKey: 'payoff_winrate' },
    },
    {
        anchorKey: 'tc_exp_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'O que é Expectativa Matemática positiva por trade e como calcular?',
        metadata: { conceptKey: 'expectancy' },
    },
    {
        anchorKey: 'tc_exp_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What is mathematical expectancy per trade and how is it calculated?',
        metadata: { conceptKey: 'expectancy' },
    },
    {
        anchorKey: 'tc_dd_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'O que significa Drawdown máximo e por que ele importa na gestão de capital?',
        metadata: { conceptKey: 'drawdown' },
    },
    {
        anchorKey: 'tc_dd_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What does Maximum Drawdown mean in portfolio and risk management?',
        metadata: { conceptKey: 'drawdown' },
    },
    {
        anchorKey: 'tc_mfemae_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'O que significam MFE e MAE na análise técnica de execução de trades?',
        metadata: { conceptKey: 'mfe_mae' },
    },
    {
        anchorKey: 'tc_mfemae_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What do MFE and MAE stand for in trade execution diagnostics?',
        metadata: { conceptKey: 'mfe_mae' },
    },
    {
        anchorKey: 'tc_sizing_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'Como calcular dimensionamento de posição, tamanho de lote e risco fixo de 1% por trade?',
        metadata: { conceptKey: 'risk_sizing' },
    },
    {
        anchorKey: 'tc_sizing_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'How does fixed-fractional position sizing and stop-loss risk per trade work?',
        metadata: { conceptKey: 'risk_sizing' },
    },
    {
        anchorKey: 'tc_overtrading_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'O que é overtrading e revenge trading na psicologia do trader?',
        metadata: { conceptKey: 'overtrading_discipline' },
    },
    {
        anchorKey: 'tc_overtrading_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'What are overtrading and revenge trading in trading psychology?',
        metadata: { conceptKey: 'overtrading_discipline' },
    },
    {
        anchorKey: 'tc_sessions_pt_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'pt',
        phrase: 'Quais são as sessões de mercado forex em UTC (Ásia, Londres, Overlap e Nova Iorque)?',
        metadata: { conceptKey: 'trading_sessions' },
    },
    {
        anchorKey: 'tc_sessions_en_1',
        domainCategory: 'TRADING_CONCEPTS',
        subIntent: 'CONCEPT_EXPLANATION',
        locale: 'en',
        phrase: 'How do global trading sessions in UTC (Asia, London, Overlap, New York) differ in liquidity?',
        metadata: { conceptKey: 'trading_sessions' },
    },

    // =========================================================================
    // 3. PERSONAL_ANALYTICS (PT + EN)
    // =========================================================================
    {
        anchorKey: 'pa_overview_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'STATUS_OVERVIEW',
        locale: 'pt',
        phrase: 'Como estão minhas operações recentes, meu lucro líquido e win rate da minha conta?',
        metadata: { focusMetrics: ['net_pnl', 'winrate', 'profit_factor', 'torex_score'] },
    },
    {
        anchorKey: 'pa_overview_pt_2',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'STATUS_OVERVIEW',
        locale: 'pt',
        phrase: 'Qual foi meu desempenho nos últimos 7 dias, esta semana ou hoje?',
        metadata: { focusMetrics: ['net_pnl', 'winrate', 'profit_factor'] },
    },
    {
        anchorKey: 'pa_overview_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'STATUS_OVERVIEW',
        locale: 'en',
        phrase: 'How are my recent trades, net PnL, win rate, and Torex Score performing?',
        metadata: { focusMetrics: ['net_pnl', 'winrate', 'profit_factor', 'torex_score'] },
    },
    {
        anchorKey: 'pa_losses_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'DIAGNOSTIC_LOSSES',
        locale: 'pt',
        phrase: 'Por que estou perdendo dinheiro e onde estão meus principais erros e drawdown?',
        metadata: { focusMetrics: ['losses', 'drawdown', 'overtrading', 'worst_symbol'] },
    },
    {
        anchorKey: 'pa_losses_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'DIAGNOSTIC_LOSSES',
        locale: 'en',
        phrase: 'Why am I losing money and what is causing my drawdown and losses?',
        metadata: { focusMetrics: ['losses', 'drawdown', 'overtrading', 'worst_symbol'] },
    },
    {
        anchorKey: 'pa_edge_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'EDGE_STRENGTHS',
        locale: 'pt',
        phrase: 'Qual é o meu Edge operacional e quais setups e ativos me trazem mais lucro?',
        metadata: { focusMetrics: ['best_symbols', 'setups', 'payoff', 'winrate'] },
    },
    {
        anchorKey: 'pa_edge_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'EDGE_STRENGTHS',
        locale: 'en',
        phrase: 'Where is my statistical edge and which setups and symbols generate the highest PnL?',
        metadata: { focusMetrics: ['best_symbols', 'setups', 'payoff', 'winrate'] },
    },
    {
        anchorKey: 'pa_symbol_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'SYMBOL_FOCUS',
        locale: 'pt',
        phrase: 'Como foi meu resultado operando XAUUSD, EURUSD ou um ativo específico na minha conta?',
        metadata: { focusMetrics: ['symbol_breakdown', 'winrate', 'net_pnl'] },
    },
    {
        anchorKey: 'pa_symbol_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'SYMBOL_FOCUS',
        locale: 'en',
        phrase: 'How did I perform on XAUUSD, EURUSD, or a specific ticker in my account?',
        metadata: { focusMetrics: ['symbol_breakdown', 'winrate', 'net_pnl'] },
    },
    {
        anchorKey: 'pa_session_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'SESSION_FOCUS',
        locale: 'pt',
        phrase: 'Qual é a minha melhor e pior sessão de trading entre Londres, Nova Iorque e Ásia?',
        metadata: { focusMetrics: ['sessions', 'winrate', 'net_pnl'] },
    },
    {
        anchorKey: 'pa_session_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'SESSION_FOCUS',
        locale: 'en',
        phrase: 'Which trading session between London, New York, and Asia is my best and worst?',
        metadata: { focusMetrics: ['sessions', 'winrate', 'net_pnl'] },
    },
    {
        anchorKey: 'pa_discipline_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'PLAN_DISCIPLINE',
        locale: 'pt',
        phrase: 'Estou seguindo as regras do meu Playbook, usando stop loss e evitando alertas ou dias ruins no diário?',
        metadata: { focusMetrics: ['sl_discipline', 'playbook', 'psych', 'alerts'] },
    },
    {
        anchorKey: 'pa_discipline_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'PLAN_DISCIPLINE',
        locale: 'en',
        phrase: 'Am I following my Playbook rules, using stop losses, and avoiding risk alerts and adverse psych days?',
        metadata: { focusMetrics: ['sl_discipline', 'playbook', 'psych', 'alerts'] },
    },
    {
        anchorKey: 'pa_improve_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'IMPROVEMENT_PLAN',
        locale: 'pt',
        phrase: 'Como posso melhorar minha consistência, meu payoff e minha gestão de risco nos próximos trades?',
        metadata: { focusMetrics: ['expectancy', 'payoff', 'discipline', 'daily_loss_limit'] },
    },
    {
        anchorKey: 'pa_improve_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'IMPROVEMENT_PLAN',
        locale: 'en',
        phrase: 'How can I improve my trading consistency, payoff ratio, and risk discipline based on my metrics?',
        metadata: { focusMetrics: ['expectancy', 'payoff', 'discipline', 'daily_loss_limit'] },
    },
    {
        anchorKey: 'pa_backtest_pt_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'STATUS_OVERVIEW',
        locale: 'pt',
        phrase: 'Analise meu win rate, lucro e desempenho nas minhas sessões de backtesting e replay.',
        metadata: {
            includeBacktesting: true,
            focusMetrics: ['backtest_winrate', 'backtest_pnl', 'backtest_sessions'],
        },
    },
    {
        anchorKey: 'pa_backtest_en_1',
        domainCategory: 'PERSONAL_ANALYTICS',
        subIntent: 'STATUS_OVERVIEW',
        locale: 'en',
        phrase: 'Analyze my win rate and performance across my backtesting sessions and replay.',
        metadata: {
            includeBacktesting: true,
            focusMetrics: ['backtest_winrate', 'backtest_pnl', 'backtest_sessions'],
        },
    },
];

/** Two anchors (PT + EN) per glossary concept, so paraphrased questions reach the same verified definition. */
const GLOSSARY_ANCHORS: SemanticIntentAnchorSeed[] = TRADING_GLOSSARY.flatMap((c) => [
    {
        anchorKey: `tc_gl_${c.key}_pt`,
        domainCategory: 'TRADING_CONCEPTS' as const,
        subIntent: 'CONCEPT_EXPLANATION' as const,
        locale: 'pt' as const,
        phrase: `O que é ${c.title} no trading e como funciona?`,
        metadata: { conceptKey: c.key },
    },
    {
        anchorKey: `tc_gl_${c.key}_en`,
        domainCategory: 'TRADING_CONCEPTS' as const,
        subIntent: 'CONCEPT_EXPLANATION' as const,
        locale: 'en' as const,
        phrase: `What is ${c.titleEn} in trading and how does it work?`,
        metadata: { conceptKey: c.key },
    },
]);

export const SEMANTIC_INTENT_ANCHORS: SemanticIntentAnchorSeed[] = [
    ...HAND_WRITTEN_ANCHORS,
    ...GLOSSARY_ANCHORS,
];

@Injectable()
export class AiSemanticIntentRouterService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AiSemanticIntentRouterService.name);
    private anchorsSynced = false;
    private syncPromise: Promise<AnchorSyncReport> | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly embeddingService: AiEmbeddingService,
        private readonly vectorStore: AiVectorStoreService,
        @Optional()
        private readonly knowledgeBase?: AiKnowledgeBaseService,
        @Optional()
        private readonly promptSystem?: AiPromptSystemService
    ) {}

    onApplicationBootstrap(): void {
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
            return;
        }
        if (this.embeddingService.getStatus().enabled) {
            void this.ensureAnchorsSynced().catch((err) =>
                this.logger.warn(
                    `Deferred semantic anchor sync skipped: ${err?.message || err}`
                )
            );
        }
    }

    private parseThreshold(envKey: string, fallback: number, min: number, max: number): number {
        const raw = this.configService.get<string>(envKey);
        if (raw === undefined || raw === null || raw === '') return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    getThresholds(): { high: number; ambiguous: number; minMargin: number } {
        return {
            high: this.parseThreshold(
                'TOREX_AI_SEMANTIC_HIGH_THRESHOLD',
                DEFAULT_HIGH_THRESHOLD,
                0.55,
                0.98
            ),
            ambiguous: this.parseThreshold(
                'TOREX_AI_SEMANTIC_LOW_THRESHOLD',
                DEFAULT_AMBIGUOUS_THRESHOLD,
                0.3,
                0.9
            ),
            minMargin: this.parseThreshold(
                'TOREX_AI_SEMANTIC_MIN_MARGIN',
                DEFAULT_MIN_MARGIN,
                0.01,
                0.4
            ),
        };
    }

    getStatus(): {
        enabled: boolean;
        anchorsSynced: boolean;
        totalSeedAnchors: number;
        categories: readonly AiDomainCategory[];
        thresholds: { high: number; ambiguous: number; minMargin: number };
    } {
        return {
            enabled: this.embeddingService.getStatus().enabled,
            anchorsSynced: this.anchorsSynced,
            totalSeedAnchors: SEMANTIC_INTENT_ANCHORS.length,
            categories: [
                'TRADING_CONCEPTS',
                'PLATFORM_KNOWLEDGE',
                'PERSONAL_ANALYTICS',
            ],
            thresholds: this.getThresholds(),
        };
    }

    async ensureAnchorsSynced(force = false): Promise<AnchorSyncReport> {
        if (this.anchorsSynced && !force) {
            return {
                totalAnchors: SEMANTIC_INTENT_ANCHORS.length,
                embeddedNow: 0,
                skippedUnchanged: SEMANTIC_INTENT_ANCHORS.length,
                enabled: this.embeddingService.getStatus().enabled,
            };
        }
        if (this.syncPromise) {
            return this.syncPromise;
        }

        if (!this.embeddingService.getStatus().enabled) {
            return {
                totalAnchors: SEMANTIC_INTENT_ANCHORS.length,
                embeddedNow: 0,
                skippedUnchanged: 0,
                enabled: false,
            };
        }

        this.syncPromise = (async () => {
            try {
                await this.vectorStore.ensureInitialized();
                const allKeys = SEMANTIC_INTENT_ANCHORS.map((a) => a.anchorKey);
                const existingHashes = await this.vectorStore.getExistingAnchorHashes(allKeys);

                const toEmbed: Array<{
                    seed: SemanticIntentAnchorSeed;
                    contentHash: string;
                }> = [];

                for (const seed of SEMANTIC_INTENT_ANCHORS) {
                    const hash = this.embeddingService.computeContentHash(
                        seed.phrase,
                        'CLASSIFICATION'
                    );
                    if (!force && existingHashes.get(seed.anchorKey) === hash) {
                        continue;
                    }
                    toEmbed.push({ seed, contentHash: hash });
                }

                if (toEmbed.length > 0) {
                    const embeddings = await this.embeddingService.embedBatch(
                        toEmbed.map((item) => ({
                            text: item.seed.phrase,
                            taskType: 'CLASSIFICATION',
                        }))
                    );

                    const upsertRows = [];
                    for (let i = 0; i < toEmbed.length; i += 1) {
                        const emb = embeddings[i];
                        if (!emb) continue;
                        upsertRows.push({
                            anchorKey: toEmbed[i].seed.anchorKey,
                            domainCategory: toEmbed[i].seed.domainCategory,
                            subIntent: toEmbed[i].seed.subIntent,
                            locale: toEmbed[i].seed.locale,
                            phrase: toEmbed[i].seed.phrase,
                            contentHash: toEmbed[i].contentHash,
                            embedding: emb.values,
                            embeddingModel: emb.model,
                            metadata: toEmbed[i].seed.metadata,
                            isActive: true,
                        });
                    }

                    if (upsertRows.length > 0) {
                        await this.vectorStore.upsertIntentAnchors(upsertRows);
                        this.anchorsSynced = upsertRows.length === toEmbed.length;
                    }
                } else {
                    this.anchorsSynced = true;
                }

                const embeddedNow = toEmbed.length;
                return {
                    totalAnchors: SEMANTIC_INTENT_ANCHORS.length,
                    embeddedNow,
                    skippedUnchanged: SEMANTIC_INTENT_ANCHORS.length - embeddedNow,
                    enabled: true,
                };
            } finally {
                this.syncPromise = null;
            }
        })();

        return this.syncPromise;
    }

    isContextualFollowUpEllipsis(
        trimmedQuestion: string,
        normalizedLookup: string,
        hasConversationHistory: boolean
    ): boolean {
        if (!hasConversationHistory) return false;
        if (trimmedQuestion.length > 36) return false;
        return /^(e |mas |e o |e a |e no |e na |e em |por que\??$|porque\??$|como assim|detalha|aprofund|explica melhor|and |but |what about |how about |why\??$|elaborate|explain more)/.test(
            normalizedLookup
        );
    }

    async classifyQuestion(params: {
        trimmedQuestion: string;
        normalizedLookup: string;
        locale: 'pt' | 'en';
        hasConversationHistory: boolean;
    }): Promise<SemanticClassificationResult> {
        const thresholds = this.getThresholds();

        if (
            this.isContextualFollowUpEllipsis(
                params.trimmedQuestion,
                params.normalizedLookup,
                params.hasConversationHistory
            )
        ) {
            return {
                confidence: 'AMBIGUOUS',
                reason: 'contextual_followup',
                topMatch: null,
                runnerUpMatch: null,
                score: 0,
                margin: 0,
                candidates: [],
                thresholds,
            };
        }

        if (!this.embeddingService.getStatus().enabled) {
            return {
                confidence: 'UNAVAILABLE',
                reason: 'embedding_disabled',
                topMatch: null,
                runnerUpMatch: null,
                score: 0,
                margin: 0,
                candidates: [],
                thresholds,
            };
        }

        try {
            await this.ensureAnchorsSynced();
            const queryEmb = await this.embeddingService.embedText(
                params.trimmedQuestion,
                { taskType: 'CLASSIFICATION' }
            );
            if (!queryEmb) {
                return {
                    confidence: 'UNAVAILABLE',
                    reason: 'embedding_failed',
                    topMatch: null,
                    runnerUpMatch: null,
                    score: 0,
                    margin: 0,
                    candidates: [],
                    thresholds,
                };
            }

            const matches = await this.vectorStore.searchIntentAnchors({
                queryVector: queryEmb.values,
                topK: 6,
                minSimilarity: 0.35,
            });

            if (!matches || matches.length === 0) {
                return {
                    confidence: 'LOW',
                    reason: 'no_anchor_matches',
                    topMatch: null,
                    runnerUpMatch: null,
                    score: 0,
                    margin: 0,
                    candidates: [],
                    thresholds,
                };
            }

            const topMatch = matches[0];
            const bestOtherDomain =
                matches.find((m) => m.domainCategory !== topMatch.domainCategory) ||
                null;
            const runnerUpScore = bestOtherDomain ? bestOtherDomain.similarity : 0;
            const score = topMatch.similarity;
            const margin = score - runnerUpScore;

            let confidence: SemanticRoutingConfidence;
            let reason: string;
            if (score >= thresholds.high && margin >= thresholds.minMargin) {
                confidence = 'HIGH';
                reason = 'high_confidence_anchor_match';
            } else if (score >= thresholds.ambiguous) {
                confidence = 'AMBIGUOUS';
                reason =
                    score >= thresholds.high
                        ? 'narrow_cross_domain_margin'
                        : 'medium_confidence_band';
            } else {
                confidence = 'LOW';
                reason = 'below_ambiguous_threshold';
            }

            return {
                confidence,
                reason,
                topMatch,
                runnerUpMatch: bestOtherDomain,
                score,
                margin,
                candidates: matches.slice(0, 3),
                thresholds,
            };
        } catch (err: any) {
            this.logger.warn(
                `Semantic classification fallback triggered (${err?.message || err})`
            );
            return {
                confidence: 'UNAVAILABLE',
                reason: 'vector_store_error',
                topMatch: null,
                runnerUpMatch: null,
                score: 0,
                margin: 0,
                candidates: [],
                thresholds,
            };
        }
    }

    extractTimeframeHint(normalizedLookup: string): RouterTimeframeHint {
        if (/\b(hoje|today|sessao de hoje|nes[st]e dia)\b/.test(normalizedLookup)) {
            return 'today';
        }
        if (
            /\b(7 dias|ultimos 7|ultima semana|esta semana|nesta semana|7d|last 7 days|this week|past week)\b/.test(
                normalizedLookup
            )
        ) {
            return 'recent_7d';
        }
        if (
            /\b(14 dias|ultimos 14|ultimas duas semanas|14d|last 14 days|two weeks)\b/.test(
                normalizedLookup
            )
        ) {
            return 'recent_14d';
        }
        if (
            /\b(30 dias|ultimos 30|este mes|nes[st]e mes|ultimo mes|30d|last 30 days|this month|last month)\b/.test(
                normalizedLookup
            )
        ) {
            return 'recent_30d';
        }
        return 'all_history';
    }

    extractTargetSymbols(
        normalizedLookup: string,
        detectedSymbolHint?: string | null,
        accountTopSymbols: string[] = []
    ): string[] {
        const targets: string[] = [];
        const addUnique = (sym: string) => {
            const clean = sym.toUpperCase().replace(/[^A-Z0-9_/]/g, '').trim();
            if (clean && !targets.includes(clean)) {
                targets.push(clean);
            }
        };

        for (const accountSym of accountTopSymbols) {
            const normSym = accountSym.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normSym.length >= 3 && normalizedLookup.includes(normSym)) {
                addUnique(accountSym);
            }
        }

        if (detectedSymbolHint) {
            addUnique(detectedSymbolHint);
        }

        return targets.slice(0, 4);
    }

    isExplicitBacktestingAnalyticsRequest(normalizedLookup: string): boolean {
        const mentionsBacktesting =
            /\b(backtest|backtesting|backtests|replay)\b/.test(normalizedLookup);
        if (!mentionsBacktesting) return false;

        const isHowToPlatform =
            /^(como |onde |qual caminho|how to |how do i |where is )/.test(
                normalizedLookup
            ) &&
            !/(meu|minha|meus|minhas|resultado|win rate|pnl|sessoes|sessions|my )/.test(
                normalizedLookup
            );

        if (isHowToPlatform) return false;

        return /(meu|minha|meus|minhas|resultado|resultados|desempenho|performance|analise|analisar|win rate|winrate|pnl|lucro|sessao|sessoes|session|sessions|my |compare|comparar)/.test(
            normalizedLookup
        );
    }
}
