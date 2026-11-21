import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
    Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import {
    AiActionLink,
    AiChatJobEntity,
    AiChatMessageEntity,
    AiChatSessionEntity,
    AiMessageUserFeedback,
    AiMetricCard,
} from './ai-chat.entity';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiTradeAnalyzerService, TraderPerformanceSnapshot } from './ai-trade-analyzer.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import { AiCreditsService } from './ai-credits.service';
import {
    AI_SUPPORT_FALLBACK_MESSAGE,
    AI_SUPPORT_FALLBACK_MESSAGE_EN,
    AiCreditStatusDto,
} from './ai-credits.entity';
import {
    AiPromptSystemService,
    AnalyticalSubIntent,
    InputInspectionResult,
} from './ai-prompt-system.service';
import { AiRouterService } from './ai-router.service';
import {
    AiDeterministicSqlToolsService,
    DeterministicSqlToolsBundle,
} from './ai-deterministic-sql-tools.service';
import { AiRagService, RagRetrievedContext } from './ai-rag.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiVectorStoreService } from './ai-vector-store.service';
import { AiSemanticIntentRouterService } from './ai-semantic-intent-router.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { ALLOWED_FEEDBACK_REASON_CODES } from './ai-learning-schema';
import { detectQuestionLocale } from './ai-language-detect';
import {
    ProfileFact,
    detectConsentReply,
    extractProfileFacts,
    formatProfileFact,
} from './ai-profile-extractor';
import { AiUserProfileService } from './ai-user-profile.service';
import { AiFeedbackSignalsService } from './ai-feedback-signals.service';
import { NumericGroundingResult, checkNumericGrounding } from './ai-numeric-grounding';
import { AiReplyCacheService, CachedAiReplyEntry } from './ai-reply-cache.service';
import {
    CLIENT_REPORTED_SIGNALS,
    ConversationTurn,
    ImplicitSignal,
    detectImplicitSignal,
    shouldAskForVote,
} from './ai-implicit-feedback';
import {
    AI_EMBEDDING_DIMENSIONS,
    ALLOWED_RAG_SOURCE_TYPES,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    FALLBACK_GEMINI_EMBEDDING_MODEL,
} from './ai-vector-schema';

const REPLY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

@Injectable()
export class TorexAiChatService implements OnModuleInit {
    private readonly logger = new Logger(TorexAiChatService.name);
    private fallbackReplyStore: AiReplyCacheService | null = null;
    private readonly jobPresence = new Map<
        string,
        { userId: string; away: boolean; lastVisiblePollAt: number; createdAt: number }
    >();

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(AiChatSessionEntity)
        private readonly sessionRepo: Repository<AiChatSessionEntity>,
        @InjectRepository(AiChatMessageEntity)
        private readonly messageRepo: Repository<AiChatMessageEntity>,
        @InjectRepository(AiChatJobEntity)
        private readonly jobRepo: Repository<AiChatJobEntity>,
        private readonly knowledgeBase: AiKnowledgeBaseService,
        private readonly tradeAnalyzer: AiTradeAnalyzerService,
        private readonly llmProvider: AiLlmProviderService,
        private readonly aiCreditsService: AiCreditsService,
        private readonly promptSystem: AiPromptSystemService,
        private readonly aiRouter: AiRouterService,
        @Optional()
        private readonly sqlTools?: AiDeterministicSqlToolsService,
        @Optional()
        private readonly ragService?: AiRagService,
        @Optional()
        private readonly embeddingService?: AiEmbeddingService,
        @Optional()
        private readonly vectorStore?: AiVectorStoreService,
        @Optional()
        private readonly semanticRouter?: AiSemanticIntentRouterService,
        @Optional()
        private readonly semanticMemory?: AiSemanticMemoryService,
        @Optional()
        private readonly privacySanitizer?: AiPrivacySanitizerService,
        @Optional()
        private readonly eventEmitter?: EventEmitter2,
        @Optional()
        private readonly userProfile?: AiUserProfileService,
        @Optional()
        private readonly feedbackSignals?: AiFeedbackSignalsService,
        @Optional()
        private readonly replyCacheService?: AiReplyCacheService
    ) {}

    async onModuleInit() {
        try {
            await this.dataSource.query(`
                CREATE TABLE IF NOT EXISTS ai_chat_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    account_id VARCHAR,
                    title VARCHAR(180) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_updated
                    ON ai_chat_sessions (user_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS ai_chat_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id UUID NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    content TEXT NOT NULL,
                    intent VARCHAR(60),
                    provider VARCHAR(40) NOT NULL DEFAULT 'deterministic_analytics',
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_created
                    ON ai_chat_messages (session_id, created_at ASC);

                CREATE TABLE IF NOT EXISTS ai_chat_jobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR NOT NULL,
                    session_id UUID NOT NULL,
                    user_message_id UUID NOT NULL,
                    assistant_message_id UUID,
                    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
                    credits_used INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_ai_chat_jobs_user_status
                    ON ai_chat_jobs (user_id, status);
                CREATE INDEX IF NOT EXISTS idx_ai_chat_jobs_session_created
                    ON ai_chat_jobs (session_id, created_at DESC);
            `);
            await this.recoverStaleProcessingJobs();
        } catch (err) {
            this.logger.warn(
                `TorexAiChatService DDL init warning: ${(err as Error).message}`
            );
        }
    }

    /**
     * Garante que jobs órfãos (ex.: reinício abrupto do servidor) nunca fiquem presos em PROCESSING
     * e sempre recebam resposta persistida na conversa correta sem perda de dados.
     * Throttled (cooldown de 60s) para evitar table scans repetitivos em getBootstrap/getSessionMessages.
     */
    private lastStaleRecoveryCheckAt = 0;

    private async recoverStaleProcessingJobs(force = false) {
        const now = Date.now();
        if (!force && now - this.lastStaleRecoveryCheckAt < 60_000) {
            return;
        }
        this.lastStaleRecoveryCheckAt = now;

        try {
            // Só jobs realmente órfãos (bem acima do guarda de getJobStatus): nunca interromper um job ativo
            const cutoff = new Date(now - 5 * 60 * 1000);
            const staleJobs = await this.jobRepo.find({
                where: {
                    status: 'PROCESSING',
                    createdAt: LessThan(cutoff),
                },
                take: 50,
            });

            for (const job of staleJobs) {
                const fallbackMsg = await this.messageRepo.save(
                    this.messageRepo.create({
                        sessionId: job.sessionId,
                        role: 'assistant',
                        content: AI_SUPPORT_FALLBACK_MESSAGE,
                        intent: 'support_fallback',
                        provider: 'system_recovery',
                        metadata: { creditsUsed: 0 },
                    })
                );
                job.assistantMessageId = fallbackMsg.id;
                job.status = 'COMPLETED';
                job.creditsUsed = 0;
                await this.jobRepo.save(job);
            }
        } catch (err) {
            this.logger.warn(
                `recoverStaleProcessingJobs warning: ${(err as Error).message}`
            );
        }
    }

    getArchitectureHealth() {
        const dual = this.llmProvider.getDualEngineStatus();
        const embedding = this.embeddingService
            ? this.embeddingService.getStatus()
            : {
                  enabled: false,
                  provider: 'none' as const,
                  model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                  fallbackModel: FALLBACK_GEMINI_EMBEDDING_MODEL,
                  dimensions: AI_EMBEDDING_DIMENSIONS,
              };
        const vectorStore = this.vectorStore
            ? this.vectorStore.getStatus()
            : {
                  initialized: false,
                  backend: 'float8_array' as const,
                  dimensions: AI_EMBEDDING_DIMENSIONS,
              };
        const semanticRouterBase = this.semanticRouter
            ? this.semanticRouter.getStatus()
            : {
                  enabled: false,
                  anchorsSynced: false,
                  totalSeedAnchors: 0,
                  categories: [
                      'TRADING_CONCEPTS',
                      'PLATFORM_KNOWLEDGE',
                      'PERSONAL_ANALYTICS',
                  ] as const,
                  thresholds: {
                      high: 0.78,
                      ambiguous: 0.58,
                      minMargin: 0.06,
                  },
              };
        const scopedRag = this.ragService
            ? this.ragService.getStatus()
            : {
                  enabled: false,
                  platformDocsSynced: false,
                  cachedUsersCount: 0,
                  allowedSources: [...ALLOWED_RAG_SOURCE_TYPES],
              };

        return {
            securityShield: {
                enabled: true,
                independentOfSemanticClassifier: true,
            },
            embedding,
            vectorStore,
            semanticRouter: {
                ...semanticRouterBase,
                qwenAmbiguousFallback: dual.qwenEnabled,
            },
            models: {
                qwenRouter: {
                    enabled: dual.qwenEnabled,
                    model: dual.qwenModel,
                    workspaceConfigured: Boolean(dual.qwenWorkspaceConfigured),
                    region: dual.qwenRegion || 'ap-southeast-1',
                    customEndpointConfigured:
                        Boolean(dual.qwenEndpoint) &&
                        !dual.qwenEndpoint.includes('qwencloudapi.com') &&
                        !dual.qwenEndpoint.includes('aliyuncs.com') &&
                        !dual.qwenEndpoint.includes('openrouter.ai'),
                },
                geminiAnalyst: {
                    enabled: dual.geminiEnabled,
                    model: dual.geminiModel,
                    ...(dual.geminiDisabledReason
                        ? { disabledReason: dual.geminiDisabledReason }
                        : {}),
                },
            },
            deterministicAnalytics: {
                enabled: Boolean(this.sqlTools),
                rawTradeHistorySentToLlm: false,
                backtestingExcludedByDefault: true,
                tools: [
                    'sql_window_kpis',
                    'sql_directional_split',
                    'sql_symbol_and_setup_matrix',
                    'sql_session_and_weekday_matrix',
                    'sql_backtesting_summary',
                ],
            },
            scopedRag,
            semanticMemory: this.semanticMemory
                ? this.semanticMemory.getStatus()
                : { enabled: false },
        };
    }

    async getBootstrap(
        userId: string,
        accountId?: string,
        locale: 'pt' | 'en' = 'pt'
    ) {
        const isEn = locale === 'en';
        await this.recoverStaleProcessingJobs();

        const [sessions, snapshot, credits, activeJobs] = await Promise.all([
            this.listSessions(userId),
            this.tradeAnalyzer.buildSnapshot(userId, accountId),
            this.aiCreditsService.getCreditStatus(userId),
            this.jobRepo.find({
                where: { userId, status: 'PROCESSING' },
                order: { createdAt: 'DESC' },
                take: 20,
            }),
        ]);

        return {
            credits,
            pendingJobs: activeJobs.map((j) => ({
                jobId: j.id,
                sessionId: j.sessionId,
                userMessageId: j.userMessageId,
            })),
            accountSummary: {
                accountLabel: snapshot.accountLabel,
                totalTrades: snapshot.totalTrades,
                netPnl: snapshot.netPnl,
                winRate: snapshot.winRate,
                profitFactor: snapshot.profitFactor,
            },
            sessions,
            coachPills: isEn
                ? [
                      { label: 'Why am I losing?', prompt: 'Why am I losing?' },
                      { label: 'Where is my Edge?', prompt: 'Where is my Edge?' },
                      { label: 'Am I following my plan?', prompt: 'Am I following my plan?' },
                      { label: 'How can I improve?', prompt: 'How can I improve?' },
                  ]
                : [
                      { label: 'Por que estou perdendo?', prompt: 'Por que estou perdendo?' },
                      { label: 'Qual é o meu Edge?', prompt: 'Qual é o meu Edge?' },
                      { label: 'Estou seguindo meu plano?', prompt: 'Estou seguindo meu plano?' },
                      { label: 'Como posso melhorar?', prompt: 'Como posso melhorar?' },
                  ],
            quickPrompts: isEn
                ? [
                      'How are my recent trades and net P&L?',
                      'What execution mistakes am I repeating lately?',
                      'How do I import trades (MT5, Deriv, or CSV)?',
                      'How do I log notes in my Journal?',
                  ]
                : [
                      'Como estão minhas operações e lucros atuais?',
                      'O que estou fazendo de errado ultimamente?',
                      'Como importar meus trades (MT5, Deriv ou CSV)?',
                      'Como anotar minhas operações no Diário?',
                  ],
        };
    }

    private isValidSessionUuid(value?: string | null): value is string {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            String(value || '').trim()
        );
    }

    private isDefaultSessionTitle(title?: string | null): boolean {
        const norm = String(title || '').trim().toLowerCase();
        return (
            !norm ||
            norm === 'nova conversa' ||
            norm === 'new thread' ||
            norm === 'new chat'
        );
    }

    async listSessions(userId: string) {
        return this.sessionRepo.find({
            where: { userId },
            order: { updatedAt: 'DESC' },
            take: 60,
        });
    }

    async createSession(params: {
        userId: string;
        sessionId?: string | null;
        accountId?: string | null;
        title?: string | null;
        locale?: 'pt' | 'en';
    }) {
        const locale: 'pt' | 'en' = params.locale === 'en' ? 'en' : 'pt';
        const candidateUuid = this.isValidSessionUuid(params.sessionId)
            ? params.sessionId.trim().toLowerCase()
            : null;

        let safeExplicitId: string | undefined;
        if (candidateUuid) {
            const existingAnyOwner = await this.sessionRepo.findOne({
                where: { id: candidateUuid },
            });
            if (existingAnyOwner) {
                if (existingAnyOwner.userId === params.userId) {
                    return { session: existingAnyOwner, created: false };
                }
                safeExplicitId = undefined;
            } else {
                safeExplicitId = candidateUuid;
            }
        }

        const created = this.sessionRepo.create({
            ...(safeExplicitId ? { id: safeExplicitId } : {}),
            userId: params.userId,
            accountId:
                params.accountId && params.accountId !== 'all'
                    ? params.accountId
                    : null,
            title: this.buildSessionTitle(params.title || '', locale),
        });
        const saved = await this.sessionRepo.save(created);
        return { session: saved, created: true };
    }

    async getSessionMessages(userId: string, sessionId: string) {
        if (!this.isValidSessionUuid(sessionId)) {
            throw new NotFoundException('Conversa não encontrada');
        }
        const normalizedSessionId = sessionId.trim().toLowerCase();
        await this.recoverStaleProcessingJobs();

        const session = await this.sessionRepo.findOne({
            where: { id: normalizedSessionId, userId },
        });
        if (!session) {
            throw new NotFoundException('Conversa não encontrada');
        }

        const [messages, activeJob] = await Promise.all([
            this.messageRepo.find({
                where: { sessionId: session.id },
                order: { createdAt: 'ASC' },
            }),
            this.jobRepo.findOne({
                where: { userId, sessionId: session.id, status: 'PROCESSING' },
                order: { createdAt: 'DESC' },
            }),
        ]);

        return {
            session,
            messages,
            activeJob: activeJob
                ? {
                      jobId: activeJob.id,
                      sessionId: activeJob.sessionId,
                      userMessageId: activeJob.userMessageId,
                  }
                : null,
        };
    }

    async getJobStatus(userId: string, jobId: string, clientVisible = true) {
        const job = await this.jobRepo.findOne({
            where: { id: jobId, userId },
        });
        if (!job) {
            throw new NotFoundException('Processamento não encontrado');
        }

        if (job.status === 'PROCESSING') {
            const existingPresence = this.jobPresence.get(jobId);
            this.jobPresence.set(jobId, {
                userId,
                away: !clientVisible,
                lastVisiblePollAt: clientVisible
                    ? Date.now()
                    : existingPresence?.lastVisiblePollAt || 0,
                createdAt: existingPresence?.createdAt || Date.now(),
            });
        }

        // Auto-recuperação caso tenha ultrapassado 180s sem conclusão.
        // Análises encadeadas (router + analista + fallback) podem passar de 90s; um guarda
        // curto demais gravava o aviso de suporte enquanto a resposta real ainda estava a ser gerada.
        if (
            job.status === 'PROCESSING' &&
            Date.now() - new Date(job.createdAt).getTime() > 180_000
        ) {
            const fallbackMsg = await this.messageRepo.save(
                this.messageRepo.create({
                    sessionId: job.sessionId,
                    role: 'assistant',
                    content: AI_SUPPORT_FALLBACK_MESSAGE,
                    intent: 'support_fallback',
                    provider: 'system_timeout_guard',
                    metadata: { creditsUsed: 0 },
                })
            );
            job.assistantMessageId = fallbackMsg.id;
            job.status = 'COMPLETED';
            job.creditsUsed = 0;
            await this.jobRepo.save(job);
        }

        if (job.status === 'PROCESSING') {
            return {
                jobId: job.id,
                sessionId: job.sessionId,
                userMessageId: job.userMessageId,
                status: 'PROCESSING' as const,
            };
        }

        const [session, assistantMessage, credits] = await Promise.all([
            this.sessionRepo.findOne({
                where: { id: job.sessionId, userId },
            }),
            job.assistantMessageId
                ? this.messageRepo.findOne({
                      where: {
                          id: job.assistantMessageId,
                          sessionId: job.sessionId,
                      },
                  })
                : Promise.resolve(null),
            this.aiCreditsService.getCreditStatus(userId),
        ]);

        return {
            jobId: job.id,
            sessionId: job.sessionId,
            userMessageId: job.userMessageId,
            status: 'COMPLETED' as const,
            session,
            assistantMessage,
            creditsUsed: job.creditsUsed,
            credits,
        };
    }

    async markJobPresence(userId: string, jobId: string, away: boolean) {
        const job = await this.jobRepo.findOne({
            where: { id: jobId, userId },
        });
        if (!job) {
            throw new NotFoundException('Processamento não encontrado');
        }
        const prev = this.jobPresence.get(jobId);
        this.jobPresence.set(jobId, {
            userId,
            away: Boolean(away),
            lastVisiblePollAt: away ? prev?.lastVisiblePollAt || 0 : Date.now(),
            createdAt: prev?.createdAt || Date.now(),
        });
        return { ok: true, jobId, away: Boolean(away) };
    }

    private pruneStalePresence(now = Date.now()) {
        for (const [id, entry] of this.jobPresence.entries()) {
            if (now - entry.createdAt > 30 * 60_000) {
                this.jobPresence.delete(id);
            }
        }
    }

    private buildStructuredMetricCards(
        snap: TraderPerformanceSnapshot,
        subIntent: AnalyticalSubIntent,
        locale: 'pt' | 'en',
    ): AiMetricCard[] {
        const isEn = locale === 'en';
        const cur = snap.currency || 'USD';
        const netSign = snap.netPnl > 0 ? '+' : '';
        const cards: AiMetricCard[] = [
            {
                label: isEn ? 'Net P&L' : 'P&L Líquido',
                value: `${netSign}${snap.netPnl.toFixed(2)} ${cur}`,
                tone: snap.netPnl > 0 ? 'positive' : snap.netPnl < 0 ? 'negative' : 'neutral',
                subtext: `${snap.totalTrades} ${isEn ? 'closed trades' : 'trades fechados'}`,
            },
            {
                label: isEn ? 'Win Rate' : 'Win Rate',
                value: `${snap.winRate.toFixed(1)}%`,
                tone: snap.winRate >= 50 ? 'positive' : 'neutral',
                subtext: `${snap.wins}W / ${snap.losses}L`,
            },
        ];

        if (subIntent === 'PLAN_DISCIPLINE') {
            cards.push({
                label: isEn ? 'Journal Coverage' : 'Cobertura Diário',
                value: `${snap.journalCoveragePct}%`,
                tone: snap.journalCoveragePct >= 60 ? 'positive' : 'negative',
                subtext: `${snap.dailyNotesCount}/${snap.activeDaysCount} ${isEn ? 'days' : 'dias'}`,
            });
        } else {
            cards.push({
                label: isEn ? 'Payoff / PF' : 'Payoff / PF',
                value:
                    snap.losses === 0 && snap.wins > 0
                        ? '∞'
                        : `${snap.payoffRatio.toFixed(2)}x · ${snap.profitFactor.toFixed(2)}`,
                tone: snap.profitFactor >= 1.2 ? 'positive' : snap.profitFactor > 0 ? 'negative' : 'neutral',
                subtext: isEn ? 'Avg R:R & Profit Factor' : 'Risco/Retorno e PF',
            });
        }

        return cards.slice(0, 3);
    }

    async deleteSession(userId: string, sessionId: string) {
        if (!this.isValidSessionUuid(sessionId)) {
            throw new NotFoundException('Conversa não encontrada');
        }
        const normalizedSessionId = sessionId.trim().toLowerCase();
        const session = await this.sessionRepo.findOne({
            where: { id: normalizedSessionId, userId },
        });
        if (!session) {
            throw new NotFoundException('Conversa não encontrada');
        }
        await this.jobRepo.delete({ sessionId: session.id, userId });
        await this.messageRepo.delete({ sessionId: session.id });
        await this.sessionRepo.delete({ id: session.id, userId });
        return { ok: true };
    }

    private buildSessionTitle(
        question: string,
        locale: 'pt' | 'en' = 'pt'
    ): string {
        const clean = String(question || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!clean) return locale === 'en' ? 'New Thread' : 'Nova Conversa';
        return clean.length > 52 ? `${clean.slice(0, 52).trim()}…` : clean;
    }

    /** Cache keys start with `${userId}::`; the user part scopes invalidation. */
    private storeReplyInCache(key: string, entry: CachedAiReplyEntry): void {
        const userId = key.split('::')[0];
        void this.replyStore.set(userId, key, entry).catch((err) =>
            this.logger.warn(`Reply cache write skipped: ${(err as Error).message}`)
        );
    }

    /** Shared Redis-backed store when injected; in-process fallback otherwise (tests, no Redis). */
    private get replyStore(): AiReplyCacheService {
        if (!this.fallbackReplyStore) {
            this.fallbackReplyStore = this.replyCacheService || new AiReplyCacheService();
        }
        return this.fallbackReplyStore;
    }

    private buildEphemeralFallbackResponse(
        userId: string,
        question: string,
        sessionId?: string | null,
        accountId?: string | null,
        locale: 'pt' | 'en' = 'pt'
    ) {
        const isEn = locale === 'en';
        const nowIso = new Date();
        const fallbackSessionId = sessionId || `fallback-${Date.now()}`;
        return {
            session: {
                id: fallbackSessionId,
                userId,
                accountId: accountId || null,
                title: this.buildSessionTitle(question, locale),
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            userMessage: {
                id: `u-fb-${Date.now()}`,
                sessionId: fallbackSessionId,
                role: 'user' as const,
                content: question,
                intent: 'user_query',
                provider: 'client',
                metadata: {},
                createdAt: nowIso,
            },
            assistantMessage: {
                id: `a-fb-${Date.now()}`,
                sessionId: fallbackSessionId,
                role: 'assistant' as const,
                content: isEn
                    ? AI_SUPPORT_FALLBACK_MESSAGE_EN
                    : AI_SUPPORT_FALLBACK_MESSAGE,
                intent: 'support_fallback',
                provider: 'system_guard',
                metadata: {},
                createdAt: nowIso,
            },
            creditsUsed: 0,
        };
    }

    /**
     * Núcleo unificado de geração e persistência da resposta do assistente na `session.id` exata.
     * Nunca lança exceção não tratada — em qualquer falha grava `AI_SUPPORT_FALLBACK_MESSAGE` na conversa correta.
     */
    private async generateWithProfile(
        ctx: Parameters<TorexAiChatService['generateAndPersistAssistantReply']>[0]
    ): Promise<{
        assistantMessage: AiChatMessageEntity;
        creditsUsed: number;
        credits: AiCreditStatusDto;
    }> {
        // What this new message says about the previous reply (rephrase, suggestion click, follow-up).
        // Consent answers are skipped: their chips are not a judgement of the reply.
        if (!ctx.consentReply) {
            void this.recordImplicitSignalForNewMessage(ctx).catch((err) =>
                this.logger.warn(`Implicit feedback skipped: ${(err as Error).message}`)
            );
        }
        const result = await this.generateWithProfileInner(ctx);
        try {
            await this.maybeAskForVote(result.assistantMessage);
        } catch (err) {
            this.logger.warn(`Vote request skipped: ${(err as Error).message}`);
        }
        return result;
    }

    private async recordImplicitSignalForNewMessage(
        ctx: Parameters<TorexAiChatService['generateAndPersistAssistantReply']>[0]
    ): Promise<void> {
        if (!this.feedbackSignals) return;
        const recent = await this.messageRepo.find({
            where: { sessionId: ctx.session.id },
            order: { createdAt: 'DESC' },
            take: 6,
        });
        const consentChips = new Set(['Sim, lembra-te de mim', 'Não guardar', 'Yes, remember me', "Don't remember"]);
        const turns: ConversationTurn[] = recent
            .filter((m) => m.id !== ctx.userMsg.id)
            .map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                intent: m.intent,
                createdAt: new Date(m.createdAt),
                suggestions: (m.metadata?.suggestions || []).filter((s) => !consentChips.has(s)),
            }));
        const detected = detectImplicitSignal(
            ctx.userMsg.content,
            turns,
            new Date(ctx.userMsg.createdAt || Date.now())
        );
        if (!detected) return;
        const target = recent.find((m) => m.id === detected.targetMessageId);
        if (!target) return;
        await this.feedbackSignals.recordSignal({ userId: ctx.userId, message: target, signal: detected.signal });
    }

    /** Highlights the 👍/👎 question on the first analyst reply of a conversation and every 5th after it. */
    private async maybeAskForVote(message: AiChatMessageEntity): Promise<void> {
        if (!/^(llm|gemini|qwen)/i.test(String(message.provider || ''))) return;
        const rows = await this.dataSource.query(
            `SELECT COUNT(*)::int AS n FROM ai_chat_messages
              WHERE session_id = $1 AND role = 'assistant'
                AND (provider ILIKE 'llm%' OR provider ILIKE 'gemini%' OR provider ILIKE 'qwen%')`,
            [message.sessionId]
        );
        const n = Number((Array.isArray(rows) ? rows[0]?.n : 0) || 0);
        if (!shouldAskForVote(n)) return;
        message.metadata = { ...(message.metadata || {}), askFeedback: true };
        await this.messageRepo.save(message);
    }

    /** ACTION_CLICK and COPY come from the client; the rest is detected on the server. */
    async recordClientSignal(params: { userId: string; messageId: string; signal: string }): Promise<{ ok: true; recorded: boolean }> {
        const signal = String(params.signal || '').toUpperCase() as ImplicitSignal;
        if (!CLIENT_REPORTED_SIGNALS.includes(signal)) {
            throw new BadRequestException('Unsupported signal');
        }
        if (!this.isUuid(params.messageId)) {
            throw new BadRequestException('Invalid message ID');
        }
        const message = await this.messageRepo.findOne({ where: { id: params.messageId } });
        if (!message || message.role !== 'assistant') {
            throw new NotFoundException('Assistant message not found');
        }
        const session = await this.sessionRepo.findOne({
            where: { id: message.sessionId, userId: params.userId },
        });
        if (!session) {
            throw new NotFoundException('Chat session not found for user');
        }
        if (!this.feedbackSignals) return { ok: true, recorded: false };
        const res = await this.feedbackSignals.recordSignal({ userId: params.userId, message, signal });
        return { ok: true, recorded: res.recorded };
    }

    private async generateWithProfileInner(
        ctx: Parameters<TorexAiChatService['generateAndPersistAssistantReply']>[0]
    ): Promise<{
        assistantMessage: AiChatMessageEntity;
        creditsUsed: number;
        credits: AiCreditStatusDto;
    }> {
        const svc = this.userProfile;
        if (!svc) return this.generateAndPersistAssistantReply(ctx);
        const locale: 'pt' | 'en' = ctx.locale === 'en' ? 'en' : 'pt';

        let effectiveUserName = ctx.userName;
        let traderProfileFacts: string[] = [];
        let askConsentFor: ProfileFact[] = [];
        try {
            if (ctx.consentReply) {
                const handled = await this.handleProfileConsentReply(ctx, ctx.consentReply, locale);
                if (handled) return handled;
            }

            const newFacts = ctx.profileFacts || [];
            let profile = await svc.getProfile(ctx.userId);
            if (newFacts.length > 0) {
                if (profile.consent === 'GRANTED') {
                    profile = await svc.mergeFacts(ctx.userId, newFacts);
                } else if (profile.consent === 'PENDING') {
                    askConsentFor = newFacts;
                }
            }
            // The name just given is used in this reply even before consent: it stays in this conversation.
            const introName = newFacts.find((f) => f.type === 'NAME')?.value;
            const storedName = profile.consent === 'GRANTED' ? profile.facts.NAME?.value : undefined;
            effectiveUserName = introName || storedName || ctx.userName;
            traderProfileFacts = AiUserProfileService.describeFacts(profile, locale).slice(0, 5);
        } catch (err) {
            this.logger.warn(`User profile step skipped: ${(err as Error).message}`);
        }

        const result = await this.generateAndPersistAssistantReply({
            ...ctx,
            userName: effectiveUserName,
            traderProfileFacts,
        });

        if (askConsentFor.length > 0) {
            try {
                await this.appendProfileConsentRequest(
                    result.assistantMessage,
                    askConsentFor,
                    (ctx.profileDiscarded || []).includes('AGE'),
                    locale
                );
            } catch (err) {
                this.logger.warn(`Profile consent request not appended: ${(err as Error).message}`);
            }
        }
        return result;
    }

    private async appendProfileConsentRequest(
        message: AiChatMessageEntity,
        facts: ProfileFact[],
        ageDiscarded: boolean,
        locale: 'pt' | 'en'
    ): Promise<void> {
        const isEn = locale === 'en';
        const lines = facts.map((f) => `- ${formatProfileFact(f, locale)}`).join('\n');
        const ageNote = ageDiscarded
            ? isEn
                ? ' I never store your age.'
                : ' A idade nunca é guardada.'
            : '';
        const ask = isEn
            ? `\n\n---\nYou shared:\n${lines}\n\nShould I remember this in future conversations? It stays in your private profile and you can delete it anytime.${ageNote}`
            : `\n\n---\nPartilhaste:\n${lines}\n\nQueres que me lembre disto nas próximas conversas? Fica só no teu perfil privado e podes apagá-lo quando quiseres.${ageNote}`;
        const consentChips = isEn
            ? ['Yes, remember me', "Don't remember"]
            : ['Sim, lembra-te de mim', 'Não guardar'];
        message.content = `${message.content}${ask}`;
        message.metadata = {
            ...(message.metadata || {}),
            suggestions: [...consentChips, ...((message.metadata?.suggestions || []).slice(0, 2))],
            profileConsentRequest: { facts },
        };
        await this.messageRepo.save(message);
    }

    /** Answers to "remember me?" and explicit "forget me" commands. Returns null when not applicable. */
    private async handleProfileConsentReply(
        ctx: Parameters<TorexAiChatService['generateAndPersistAssistantReply']>[0],
        reply: 'GRANT' | 'DENY' | 'FORGET',
        locale: 'pt' | 'en'
    ): Promise<{
        assistantMessage: AiChatMessageEntity;
        creditsUsed: number;
        credits: AiCreditStatusDto;
    } | null> {
        const svc = this.userProfile!;
        const isEn = locale === 'en';
        let content: string;

        if (reply === 'FORGET') {
            await svc.deleteProfile(ctx.userId);
            content = isEn
                ? 'Done: I deleted everything I remembered about you. I will ask again before saving anything new.'
                : 'Feito: apaguei tudo o que me lembrava sobre ti. Volto a perguntar antes de guardar algo novo.';
        } else {
            const recent = await this.messageRepo.find({
                where: { sessionId: ctx.session.id, role: 'assistant' },
                order: { createdAt: 'DESC' },
                take: 4,
            });
            const pendingMsg = recent.find((m) => m.metadata?.profileConsentRequest?.facts?.length);
            if (!pendingMsg) return null;
            const pendingFacts = (pendingMsg.metadata.profileConsentRequest?.facts || []) as ProfileFact[];

            if (reply === 'GRANT') {
                const profile = await svc.setConsent(ctx.userId, true, pendingFacts);
                const lines = AiUserProfileService.describeFacts(profile, locale)
                    .map((l) => `- ${l}`)
                    .join('\n');
                content = isEn
                    ? `Got it, I will remember:\n${lines}\n\nYou can see or delete it in **Settings → AI memory**, or just write "forget my profile".`
                    : `Combinado, vou lembrar-me de:\n${lines}\n\nPodes ver ou apagar em **Configurações → Memória da IA**, ou escrever "esquece o meu perfil".`;
            } else {
                await svc.setConsent(ctx.userId, false);
                content = isEn
                    ? 'No problem: I will not keep anything about you. You can change this later in **Settings → AI memory**.'
                    : 'Sem problema: não guardo nada sobre ti. Podes mudar isto depois em **Configurações → Memória da IA**.';
            }
            pendingMsg.metadata = { ...pendingMsg.metadata, profileConsentRequest: null };
            await this.messageRepo.save(pendingMsg);
        }

        const assistantMessage = await this.messageRepo.save(
            this.messageRepo.create({
                sessionId: ctx.session.id,
                role: 'assistant',
                content,
                intent: 'profile_consent',
                provider: 'profile_memory',
                metadata: {
                    creditsUsed: 0,
                    suggestions: isEn
                        ? ['How are my recent trades?', 'Where is my Edge?']
                        : ['Como estão minhas operações?', 'Qual é o meu Edge?'],
                },
            })
        );
        await this.sessionRepo.update({ id: ctx.session.id }, { updatedAt: new Date() });
        return { assistantMessage, creditsUsed: 0, credits: ctx.initialCreditStatus };
    }

    private async generateAndPersistAssistantReply(ctx: {
        userId: string;
        userName: string;
        accountId?: string | null;
        session: AiChatSessionEntity;
        userMsg: AiChatMessageEntity;
        trimmedQuestion: string;
        inspection: InputInspectionResult;
        initialCreditStatus: AiCreditStatusDto;
        locale?: 'pt' | 'en';
        profileFacts?: ProfileFact[];
        profileDiscarded?: string[];
        consentReply?: 'GRANT' | 'DENY' | 'FORGET' | null;
        traderProfileFacts?: string[];
    }): Promise<{
        assistantMessage: AiChatMessageEntity;
        creditsUsed: number;
        credits: AiCreditStatusDto;
    }> {
        const {
            userId,
            userName,
            accountId,
            session,
            trimmedQuestion,
            inspection,
            initialCreditStatus,
        } = ctx;
        const locale: 'pt' | 'en' = ctx.locale === 'en' ? 'en' : 'pt';
        const isEn = locale === 'en';
        const fallbackSupportText = isEn
            ? AI_SUPPORT_FALLBACK_MESSAGE_EN
            : AI_SUPPORT_FALLBACK_MESSAGE;

        const hasAtomicReserve =
            typeof (this.aiCreditsService as any)?.reserveCredits === 'function' &&
            typeof (this.aiCreditsService as any)?.settleReservedCredits === 'function';
        let reservedAmount = 0;
        let settled = false;
        let liveCredits = initialCreditStatus;

        const settleCredits = async (targetCost: number) => {
            settled = true;
            const cleanCost = Math.max(0, Math.round(targetCost || 0));
            if (hasAtomicReserve) {
                return (this.aiCreditsService as any).settleReservedCredits(
                    userId,
                    reservedAmount,
                    cleanCost,
                );
            }
            if (cleanCost <= 0) {
                return { creditsUsed: 0, credits: liveCredits };
            }
            return this.aiCreditsService.consumeCredits(userId, cleanCost);
        };

        try {
            // Reserva atómica no início para evitar race condition com requisições paralelas
            if (hasAtomicReserve) {
                const reservation = await (this.aiCreditsService as any).reserveCredits(userId, 1);
                liveCredits = reservation.credits;
                reservedAmount = reservation.reserved ? reservation.reservedAmount : 0;
                if (!reservation.reserved || !liveCredits.canInteract) {
                    settled = true;
                    const assistantMsg = await this.messageRepo.save(
                        this.messageRepo.create({
                            sessionId: session.id,
                            role: 'assistant',
                            content: fallbackSupportText,
                            intent: 'support_fallback',
                            provider: 'system_guard',
                            metadata: { creditsUsed: 0, failureReason: 'NO_CREDITS' },
                        })
                    );

                    await this.sessionRepo.update(
                        { id: session.id },
                        { updatedAt: new Date() }
                    );

                    return {
                        assistantMessage: assistantMsg,
                        creditsUsed: 0,
                        credits: liveCredits,
                    };
                }
            } else {
                liveCredits = await this.aiCreditsService.getCreditStatus(userId);

                // 1. Sem créditos ou sem plano ativo -> mensagem oficial de suporte
                if (!liveCredits.canInteract || liveCredits.creditsRemaining <= 0) {
                    settled = true;
                    const assistantMsg = await this.messageRepo.save(
                        this.messageRepo.create({
                            sessionId: session.id,
                            role: 'assistant',
                            content: fallbackSupportText,
                            intent: 'support_fallback',
                            provider: 'system_guard',
                            metadata: { creditsUsed: 0, failureReason: 'NO_CREDITS' },
                        })
                    );

                    await this.sessionRepo.update(
                        { id: session.id },
                        { updatedAt: new Date() }
                    );

                    return {
                        assistantMessage: assistantMsg,
                        creditsUsed: 0,
                        credits: liveCredits,
                    };
                }
            }

            // 2. Carrega o histórico anterior da sessão para verificar Grill-Me pendente e contexto de conversa
            // Most recent 14 messages (DESC + take), then back to chronological order. With ASC the
            // window was the first 14 messages, so long conversations lost their latest context.
            const rawSessionMessages = (
                await this.messageRepo.find({
                    where: { sessionId: session.id },
                    order: { createdAt: 'DESC' },
                    take: 14,
                })
            ).reverse();
            const previousMessages = rawSessionMessages.filter(
                (m) => m.id !== ctx.userMsg.id
            );

            const activeGrillMe =
                this.aiRouter.extractActiveGrillMeState(previousMessages);

            // Evita consulta ao banco de trades quando é saudação, fora de escopo, suporte à plataforma ou conceito teórico (e sem Grill-Me ativo)
            const skipAccountFetch =
                !activeGrillMe &&
                (inspection.category === 'GREETING' ||
                    inspection.category === 'OUT_OF_SCOPE' ||
                    inspection.category === 'SIGNAL_REQUEST' ||
                    inspection.category === 'PLATFORM_SUPPORT' ||
                    inspection.category === 'TRADING_EDUCATION');

            const snapshot = skipAccountFetch
                ? null
                : await this.tradeAnalyzer.buildSnapshot(userId, accountId);

            const dataFingerprint = snapshot
                ? `${snapshot.totalTrades}:${snapshot.netPnl}:${snapshot.openPositionsCount}:${snapshot.dailyNotesCount}:${snapshot.unresolvedAlertsCount ?? 0}`
                : 'no_personal_data';

            // 2A. Verifica Cache Rápido antes de chamar IA (somente quando não há Grill-Me ativo na conversa)
            const directCacheKey = `${userId}::${locale}::${accountId || 'all'}::${inspection.normalizedLookup}::${dataFingerprint}`;
            if (!activeGrillMe) {
                const cachedHit = await this.replyStore
                    .get(userId, directCacheKey)
                    .catch(() => null);
                if (cachedHit) {
                    const settledRes = await settleCredits(0);
                    const cachedAssistantMsg = await this.messageRepo.save(
                        this.messageRepo.create({
                            sessionId: session.id,
                            role: 'assistant',
                            content: cachedHit.content,
                            intent: cachedHit.intent,
                            provider: 'cache_hit',
                            metadata: {
                                metrics: [],
                                actions: cachedHit.actions || [],
                                suggestions: cachedHit.suggestions,
                                creditsUsed: 0,
                            },
                        })
                    );

                    await this.sessionRepo.update(
                        { id: session.id },
                        { updatedAt: new Date() }
                    );

                    return {
                        assistantMessage: cachedAssistantMsg,
                        creditsUsed: 0,
                        credits: settledRes.credits,
                    };
                }
            }

            // 3. CAMADA 1 — ROTEADOR INTELIGENTE QWEN (Single-Pass: Guardrail | Resposta Direta | Grill-Me | Escalar p/ Gemini)
            const accountHint =
                this.aiRouter.buildLightweightAccountHint(snapshot);
            const routeDecision = await this.aiRouter.routeUserMessage({
                userName,
                trimmedQuestion,
                inspection,
                previousMessages,
                accountHint,
                locale,
                userId,
                accountId,
            });

            // 3A. Decisão: BLOCK_GUARDRAIL (Abuso, Fora de Escopo ou Especulação sem Fundamento) — 0 créditos
            if (routeDecision.decision === 'BLOCK_GUARDRAIL') {
                const settledRes = await settleCredits(0);
                const assistantMsg = await this.messageRepo.save(
                    this.messageRepo.create({
                        sessionId: session.id,
                        role: 'assistant',
                        content:
                            routeDecision.reply ||
                            'Sou o **Torex AI**, dedicado exclusivamente à análise objetiva de performance e uso do **Torex Journal**.',
                        intent: routeDecision.intent,
                        provider: routeDecision.routerProvider,
                        metadata: {
                            actions: routeDecision.actions,
                            suggestions: routeDecision.suggestions,
                            creditsUsed: 0,
                            tokensUsed: routeDecision.routerTokensUsed,
                            grillMeState: null,
                            routerDecision: routeDecision.decision,
                            routerModel: routeDecision.routerModel,
                            domainCategory: routeDecision.domainCategory,
                            semanticConfidence: routeDecision.semanticConfidence,
                            semanticScore: routeDecision.semanticScore,
                            matchedAnchorKey: routeDecision.matchedAnchorKey,
                            semanticMemoryId: routeDecision.semanticMemoryId,
                            memoryHitScope: routeDecision.memoryHitScope,
                            hybridScore: routeDecision.hybridScore,
                            lexicalExpansions: routeDecision.lexicalExpansions,
                            routerLatencyMs: routeDecision.routerLatencyMs,
                        },
                    })
                );

                await this.sessionRepo.update(
                    { id: session.id },
                    { updatedAt: new Date() }
                );

                return {
                    assistantMessage: assistantMsg,
                    creditsUsed: 0,
                    credits: settledRes.credits,
                };
            }

            // 3B. Decisão: CLARIFY_USER (Modo Grill-Me nos bastidores para perguntas incompletas) — 0 créditos
            if (routeDecision.decision === 'CLARIFY_USER') {
                const settledRes = await settleCredits(0);
                const assistantMsg = await this.messageRepo.save(
                    this.messageRepo.create({
                        sessionId: session.id,
                        role: 'assistant',
                        content:
                            routeDecision.reply ||
                            'Pode especificar qual ativo, período ou aspeto do seu operacional deseja analisar?',
                        intent: routeDecision.intent,
                        provider: routeDecision.routerProvider,
                        metadata: {
                            actions: [],
                            suggestions: routeDecision.suggestions,
                            creditsUsed: 0,
                            tokensUsed: routeDecision.routerTokensUsed,
                            grillMeState: routeDecision.nextGrillMeState,
                            routerDecision: routeDecision.decision,
                            routerModel: routeDecision.routerModel,
                            domainCategory: routeDecision.domainCategory,
                            semanticConfidence: routeDecision.semanticConfidence,
                            semanticScore: routeDecision.semanticScore,
                            matchedAnchorKey: routeDecision.matchedAnchorKey,
                            semanticMemoryId: routeDecision.semanticMemoryId,
                            memoryHitScope: routeDecision.memoryHitScope,
                            hybridScore: routeDecision.hybridScore,
                            lexicalExpansions: routeDecision.lexicalExpansions,
                            routerLatencyMs: routeDecision.routerLatencyMs,
                        },
                    })
                );

                await this.sessionRepo.update(
                    { id: session.id },
                    { updatedAt: new Date() }
                );

                return {
                    assistantMessage: assistantMsg,
                    creditsUsed: 0,
                    credits: settledRes.credits,
                };
            }

            // 3C. Decisão: DIRECT_REPLY (Respondido diretamente pelo Qwen: Saudação, Conceitos ou Guia da Plataforma)
            if (routeDecision.decision === 'DIRECT_REPLY') {
                const verifiedDirectReply =
                    this.promptSystem.verifyModelOutput(routeDecision.reply, locale) ||
                    routeDecision.reply ||
                    'Posso ajudá-lo a importar trades em `/add-trades`, simular estratégias em `/backtesting` ou gerir o seu `/journal`.';

                let creditsUsed = 0;
                let updatedCredits = liveCredits;
                let estimatedOrActualTokens = routeDecision.routerTokensUsed;

                if (routeDecision.chargeCreditsMode === 'LIGHT_GUIDE') {
                    const costCalc =
                        this.aiCreditsService.calculateInteractionCost({
                            question: trimmedQuestion,
                            reply: verifiedDirectReply,
                            completionTokens: routeDecision.routerTokensUsed,
                            isQuickGuide: true,
                        });
                    estimatedOrActualTokens =
                        routeDecision.routerTokensUsed ||
                        costCalc.estimatedTokens;
                    const consumption = await settleCredits(costCalc.cost);
                    creditsUsed = consumption.creditsUsed;
                    updatedCredits = consumption.credits;
                } else {
                    const freeRes = await settleCredits(0);
                    updatedCredits = freeRes.credits;
                }

                if (!activeGrillMe) {
                    this.storeReplyInCache(directCacheKey, {
                        content: verifiedDirectReply,
                        intent: routeDecision.intent,
                        actions: routeDecision.actions,
                        suggestions: routeDecision.suggestions,
                        expiresAt: Date.now() + REPLY_CACHE_TTL_MS,
                    });
                }

                const assistantMsg = await this.messageRepo.save(
                    this.messageRepo.create({
                        sessionId: session.id,
                        role: 'assistant',
                        content: verifiedDirectReply,
                        intent: routeDecision.intent,
                        provider: routeDecision.routerProvider,
                        metadata: {
                            actions: routeDecision.actions,
                            suggestions: routeDecision.suggestions,
                            creditsUsed,
                            tokensUsed: estimatedOrActualTokens,
                            grillMeState: null,
                            routerDecision: routeDecision.decision,
                            routerModel: routeDecision.routerModel,
                            domainCategory: routeDecision.domainCategory,
                            semanticConfidence: routeDecision.semanticConfidence,
                            semanticScore: routeDecision.semanticScore,
                            matchedAnchorKey: routeDecision.matchedAnchorKey,
                            semanticMemoryId: routeDecision.semanticMemoryId,
                            memoryHitScope: routeDecision.memoryHitScope,
                            hybridScore: routeDecision.hybridScore,
                            lexicalExpansions: routeDecision.lexicalExpansions,
                            routerLatencyMs: routeDecision.routerLatencyMs,
                        },
                    })
                );

                await this.sessionRepo.update(
                    { id: session.id },
                    { updatedAt: new Date() }
                );

                return {
                    assistantMessage: assistantMsg,
                    creditsUsed,
                    credits: updatedCredits,
                };
            }

            // 4. CAMADA 2 — ESCALATE_TO_GEMINI (Análise Quantitativa Profunda sobre Dados Auditados)
            const handoff = routeDecision.handoff || {
                formalizedQuestion: trimmedQuestion,
                analyticalObjective: inspection.expandedInstruction,
                subIntent: inspection.subIntent || 'STATUS_OVERVIEW',
                targetSymbols: inspection.detectedSymbolHint
                    ? [inspection.detectedSymbolHint]
                    : [],
                timeframeHint: 'all_history' as const,
                includeJournalNotes: true,
                includePlaybookRules: true,
                includeBacktesting: false,
                focusMetrics: ['net_pnl', 'winrate', 'payoff', 'sessions'],
            };

            const [ensuredSnapshot, sqlToolsBundle, ragContext] =
                await Promise.all([
                    snapshot
                        ? Promise.resolve(snapshot)
                        : this.tradeAnalyzer.buildSnapshot(userId, accountId),
                    this.sqlTools
                        ? this.sqlTools
                              .executeAnalyticalTools({
                                  userId,
                                  accountId,
                                  handoff,
                              })
                              .catch(
                                  () =>
                                      null as DeterministicSqlToolsBundle | null
                              )
                        : Promise.resolve(
                              null as DeterministicSqlToolsBundle | null
                          ),
                    this.ragService
                        ? this.ragService
                              .retrieveForAnalyticsHandoff({
                                  userId,
                                  accountId,
                                  query: handoff.formalizedQuestion,
                                  includeJournalNotes:
                                      handoff.includeJournalNotes,
                                  includePlaybookRules:
                                      handoff.includePlaybookRules,
                              })
                              .catch(
                                  () =>
                                      ({
                                          chunks: [],
                                          sourcesUsed: [],
                                          syncedChunks: 0,
                                      }) as RagRetrievedContext
                              )
                        : Promise.resolve(null as RagRetrievedContext | null),
                ]);

            const hasBacktestingSessions = Boolean(
                handoff.includeBacktesting &&
                    (sqlToolsBundle?.backtestingSummary?.sessionsCount ?? 0) > 0
            );
            const isAccountEmpty =
                ensuredSnapshot.totalTrades === 0 &&
                ensuredSnapshot.openPositionsCount === 0 &&
                !hasBacktestingSessions;

            // 4A. Guardrail ZERO_DATA (0% alucinação para contas sem nenhuma operação)
            if (isAccountEmpty) {
                const settledRes = await settleCredits(0);
                const zeroData = this.promptSystem.buildZeroDataResponse({
                    userName,
                    accountLabel: ensuredSnapshot.accountLabel,
                    sanitizedQuestion:
                        routeDecision.handoff?.formalizedQuestion ||
                        trimmedQuestion,
                    locale,
                });

                const assistantMsg = await this.messageRepo.save(
                    this.messageRepo.create({
                        sessionId: session.id,
                        role: 'assistant',
                        content: zeroData.reply,
                        intent: 'zero_data_guard',
                        provider: 'zero_data_guard',
                        metadata: {
                            actions: zeroData.actions,
                            suggestions: zeroData.suggestions,
                            accountLabel: ensuredSnapshot.accountLabel,
                            creditsUsed: 0,
                            grillMeState: null,
                            routerDecision: routeDecision.decision,
                            routerModel: routeDecision.routerModel,
                            domainCategory: routeDecision.domainCategory,
                            semanticConfidence: routeDecision.semanticConfidence,
                            semanticScore: routeDecision.semanticScore,
                        },
                    })
                );

                await this.sessionRepo.update(
                    { id: session.id },
                    { updatedAt: new Date() }
                );

                return {
                    assistantMessage: assistantMsg,
                    creditsUsed: 0,
                    credits: settledRes.credits,
                };
            }

            const dualEngine = this.llmProvider.getDualEngineStatus();
            const deterministic =
                this.tradeAnalyzer.composeDeterministicCoachResponse(
                    handoff.formalizedQuestion,
                    userName,
                    ensuredSnapshot,
                    locale
                );

            let finalReply = deterministic.reply;
            let providerUsed = 'deterministic_analytics';
            let analystModelUsed = 'local_analytics';
            let analystLatencyMs: number | undefined;
            let completionTokens: number | undefined;
            let totalTokens: number | undefined;
            let analystFailureReason:
                | 'LLM_UNAVAILABLE'
                | 'LLM_FAILED'
                | 'LLM_OUTPUT_REJECTED'
                | 'LLM_NUMBERS_UNGROUNDED'
                | null = null;
            let numericGrounding: (NumericGroundingResult & { retried: boolean }) | null = null;
            let numbersUngrounded = false;
            let analystTruncated = false;
            let cavemanTokensSaved: number | undefined;

            if (dualEngine.anyEnabled) {
                const cleanHistory = previousMessages.filter(
                    (m) =>
                        m.intent !== 'support_fallback' &&
                        !String(m.content || '').includes(
                            'Panorama das Suas Operações'
                        ) &&
                        !String(m.content || '').includes(
                            'Diagnóstico de Vazamento'
                        )
                );

                const compiledGeminiPrompt =
                    this.promptSystem.compileGeminiHandoffPrompt({
                        userName,
                        traderProfile: ctx.traderProfileFacts || [],
                        inspection,
                        handoff,
                        snapshot: ensuredSnapshot,
                        sqlToolsBundle,
                        ragContext,
                        platformMapSummary:
                            this.knowledgeBase.getPlatformContextSummary(locale),
                        recentAssistantReplies: cleanHistory
                            .filter((m) => m.role === 'assistant')
                            .slice(-3)
                            .map((m) => m.content),
                        locale,
                    });
                cavemanTokensSaved = compiledGeminiPrompt.cavemanTokensSaved;

                const analystHistory = cleanHistory.map((m) => ({
                    role: m.role,
                    content: m.content,
                }));
                let geminiResult =
                    await this.llmProvider.generateGeminiAnalysis({
                        systemPrompt: compiledGeminiPrompt.systemPrompt,
                        userTaskPrompt: compiledGeminiPrompt.userTaskPrompt,
                        history: analystHistory,
                    });

                // 1 retry automático se falhar por oscilação transitória de rede/provedor
                if (geminiResult?.failed) {
                    await new Promise((r) => setTimeout(r, 600));
                    geminiResult =
                        await this.llmProvider.generateGeminiAnalysis({
                            systemPrompt: compiledGeminiPrompt.systemPrompt,
                            userTaskPrompt: compiledGeminiPrompt.userTaskPrompt,
                            history: analystHistory,
                        });
                }

                let verifiedText = this.promptSystem.verifyModelOutput(
                    geminiResult?.text,
                    locale
                );

                // Every material figure must come from the audited data in the prompt.
                // One retry with the offending figures named; then the deterministic analysis.
                const groundingSources = [
                    compiledGeminiPrompt.systemPrompt,
                    compiledGeminiPrompt.userTaskPrompt,
                ];
                if (verifiedText && !geminiResult?.failed) {
                    let grounding = checkNumericGrounding(verifiedText, groundingSources);
                    numericGrounding = { ...grounding, retried: false };
                    if (!grounding.grounded) {
                        const correction = locale === 'en'
                            ? `\n\nCORRECTION: your previous answer used figures that are not in the verified data (${grounding.ungrounded.join(', ')}). Rewrite it using only numbers present in <dados_verificados_conta> and <ferramentas_sql_deterministicas>.`
                            : `\n\nCORREÇÃO: a resposta anterior usou números que não existem nos dados verificados (${grounding.ungrounded.join(', ')}). Reescreve usando apenas números presentes em <dados_verificados_conta> e <ferramentas_sql_deterministicas>.`;
                        geminiResult = await this.llmProvider.generateGeminiAnalysis({
                            systemPrompt: compiledGeminiPrompt.systemPrompt,
                            userTaskPrompt: `${compiledGeminiPrompt.userTaskPrompt}${correction}`,
                            history: analystHistory,
                        });
                        verifiedText = this.promptSystem.verifyModelOutput(geminiResult?.text, locale);
                        grounding = verifiedText
                            ? checkNumericGrounding(verifiedText, groundingSources)
                            : grounding;
                        numericGrounding = { ...grounding, retried: true };
                        if (!grounding.grounded) {
                            verifiedText = null;
                            numbersUngrounded = true;
                        }
                    }
                }

                if (geminiResult?.failed || !verifiedText) {
                    // Keep the deterministic analysis already computed from audited SQL data instead of
                    // replying with a generic support message, and record why the analyst failed.
                    analystFailureReason = numbersUngrounded
                        ? 'LLM_NUMBERS_UNGROUNDED'
                        : !geminiResult
                        ? 'LLM_UNAVAILABLE'
                        : geminiResult.failed
                          ? 'LLM_FAILED'
                          : 'LLM_OUTPUT_REJECTED';
                    this.logger.warn(
                        `[TorexAiChatService] Analyst ${analystFailureReason} on session ${session.id}; serving deterministic analysis.`
                    );
                    providerUsed = 'deterministic_analytics_fallback';
                } else {
                    finalReply = verifiedText;
                    providerUsed = geminiResult?.providerUsed || 'llm:gemini';
                    analystModelUsed =
                        geminiResult?.modelUsed || dualEngine.geminiModel;
                    analystLatencyMs = geminiResult?.latencyMs;
                    completionTokens = geminiResult?.completionTokens;
                    analystTruncated = Boolean(geminiResult?.truncated);
                    totalTokens =
                        (geminiResult?.totalTokens || 0) +
                            (routeDecision.routerTokensUsed || 0) || undefined;
                }
            }

            // 5. Consumo proporcional de créditos para análise completa.
            // A degraded deterministic answer after an analyst failure is not charged.
            const { cost, estimatedTokens } =
                this.aiCreditsService.calculateInteractionCost({
                    question: handoff.formalizedQuestion,
                    reply: finalReply,
                    completionTokens,
                    isQuickGuide: false,
                });

            const consumption = await settleCredits(analystFailureReason ? 0 : cost);

            const structuredMetrics = this.buildStructuredMetricCards(
                ensuredSnapshot,
                handoff.subIntent,
                locale,
            );

            const baseSuggestions =
                routeDecision.suggestions.length > 0
                    ? routeDecision.suggestions
                    : deterministic.suggestions;

            const contextualRecs =
                this.promptSystem.buildContextualRecommendations(
                    ensuredSnapshot,
                    {
                        ...inspection,
                        subIntent: handoff.subIntent,
                    },
                    [],
                    baseSuggestions,
                    locale
                );

            const resolvedActions =
                this.knowledgeBase.resolveRouteActionsFromText(finalReply, locale);
            const resolvedIntent =
                routeDecision.intent ||
                handoff.subIntent.toLowerCase() ||
                deterministic.intent;

            const handoffCacheKey = `${userId}::${locale}::${accountId || 'all'}::${this.promptSystem.normalizeLookup(handoff.formalizedQuestion)}::${ensuredSnapshot.totalTrades}:${ensuredSnapshot.netPnl}:${ensuredSnapshot.openPositionsCount}:${ensuredSnapshot.dailyNotesCount}:${ensuredSnapshot.unresolvedAlertsCount ?? 0}:bt:${handoff.includeBacktesting ? 1 : 0}:${sqlToolsBundle?.backtestingSummary?.sessionsCount ?? 0}`;
            // Do not cache degraded or truncated answers: the next identical question should retry the analyst.
            if (!analystFailureReason && !analystTruncated) {
                this.storeReplyInCache(handoffCacheKey, {
                    content: finalReply,
                    intent: resolvedIntent,
                    actions: resolvedActions,
                    suggestions: contextualRecs.suggestions,
                    expiresAt: Date.now() + REPLY_CACHE_TTL_MS,
                });
            }

            const assistantMsg = await this.messageRepo.save(
                this.messageRepo.create({
                    sessionId: session.id,
                    role: 'assistant',
                    content: finalReply,
                    intent: resolvedIntent,
                    provider: providerUsed,
                    metadata: {
                        metrics: structuredMetrics,
                        actions: resolvedActions,
                        suggestions: contextualRecs.suggestions,
                        accountLabel: ensuredSnapshot.accountLabel,
                        creditsUsed: consumption.creditsUsed,
                        tokensUsed: totalTokens || estimatedTokens,
                        cavemanTokensSaved,
                        failureReason: analystFailureReason,
                        analystTruncated,
                        numericGrounding,
                        grillMeState: null,
                        routerDecision: routeDecision.decision,
                        routerModel: routeDecision.routerModel,
                        analystModel: analystModelUsed,
                        domainCategory: routeDecision.domainCategory,
                        semanticConfidence: routeDecision.semanticConfidence,
                        semanticScore: routeDecision.semanticScore,
                        matchedAnchorKey: routeDecision.matchedAnchorKey,
                        semanticMemoryId: routeDecision.semanticMemoryId,
                        memoryHitScope: routeDecision.memoryHitScope,
                        hybridScore: routeDecision.hybridScore,
                        lexicalExpansions: routeDecision.lexicalExpansions,
                        routerLatencyMs: routeDecision.routerLatencyMs,
                        analystLatencyMs,
                        sqlToolsUsed: sqlToolsBundle?.toolsExecuted || [],
                        ragSourcesUsed: ragContext?.sourcesUsed || [],
                        ragChunksCount: ragContext?.chunks.length || 0,
                        backtestingIncluded: Boolean(
                            handoff.includeBacktesting
                        ),
                    },
                })
            );

            await this.sessionRepo.update(
                { id: session.id },
                { updatedAt: new Date() }
            );

            return {
                assistantMessage: assistantMsg,
                creditsUsed: consumption.creditsUsed,
                credits: consumption.credits,
            };
        } catch (err) {
            if (!settled && reservedAmount > 0) {
                await settleCredits(0).catch(() => undefined);
            }
            this.logger.error(
                `[TorexAiChatService] Falha interna na sessão ${session.id}: ${(err as Error).message}`
            );
            const fallbackMsg = await this.messageRepo.save(
                this.messageRepo.create({
                    sessionId: session.id,
                    role: 'assistant',
                    content: fallbackSupportText,
                    intent: 'support_fallback',
                    provider: 'system_guard',
                    metadata: {
                        creditsUsed: 0,
                        failureReason: 'EXCEPTION',
                        failureDetail: String((err as Error)?.message || err).slice(0, 300),
                    },
                })
            );

            await this.sessionRepo.update(
                { id: session.id },
                { updatedAt: new Date() }
            );

            return {
                assistantMessage: fallbackMsg,
                creditsUsed: 0,
                credits: initialCreditStatus,
            };
        }
    }

    private async resolveOrCreateSessionForMessage(params: {
        userId: string;
        sessionId?: string | null;
        accountId?: string | null;
        firstMessageText: string;
        locale: 'pt' | 'en';
    }): Promise<AiChatSessionEntity> {
        const candidateUuid = this.isValidSessionUuid(params.sessionId)
            ? params.sessionId.trim().toLowerCase()
            : null;

        let safeExplicitId: string | undefined;
        if (candidateUuid) {
            const existingAnyOwner = await this.sessionRepo.findOne({
                where: { id: candidateUuid },
            });
            if (existingAnyOwner) {
                if (existingAnyOwner.userId === params.userId) {
                    if (this.isDefaultSessionTitle(existingAnyOwner.title)) {
                        existingAnyOwner.title = this.buildSessionTitle(
                            params.firstMessageText,
                            params.locale
                        );
                    }
                    existingAnyOwner.updatedAt = new Date();
                    return this.sessionRepo.save(existingAnyOwner);
                }
                safeExplicitId = undefined;
            } else {
                safeExplicitId = candidateUuid;
            }
        }

        const created = this.sessionRepo.create({
            ...(safeExplicitId ? { id: safeExplicitId } : {}),
            userId: params.userId,
            accountId:
                params.accountId && params.accountId !== 'all'
                    ? params.accountId
                    : null,
            title: this.buildSessionTitle(params.firstMessageText, params.locale),
        });
        return this.sessionRepo.save(created);
    }

    /**
     * Modo Assíncrono Persistente:
     * 1. Cria/carrega a sessão e salva imediatamente a mensagem do utilizador no PostgreSQL.
     * 2. Regista um job persistente vinculado ao `session.id` exato.
     * 3. Dispara o processamento em background garantindo gravação no chat correto mesmo se o utilizador trocar de aba/conversa.
     */
    async enqueueMessage(params: {
        userId: string;
        userName: string;
        question: string;
        sessionId?: string | null;
        accountId?: string | null;
        locale?: 'pt' | 'en';
    }) {
        const rawTrimmed = String(params.question || '').trim();
        // Reply in the language of the question; the UI locale only breaks ties.
        const locale: 'pt' | 'en' = detectQuestionLocale(
            rawTrimmed,
            params.locale === 'en' ? 'en' : 'pt'
        );
        if (!rawTrimmed) {
            throw new BadRequestException(locale === 'en' ? 'Empty message' : 'Mensagem vazia');
        }

        try {
            const creditStatus = await this.aiCreditsService.getCreditStatus(
                params.userId
            );
            const maxChars = creditStatus.maxMessageChars || 50;
            const displayInspection = this.promptSystem.inspectAndClassifyInput(
                rawTrimmed,
                maxChars,
                locale
            );
            // What the user typed stays in their conversation as written.
            const trimmed =
                displayInspection.sanitizedQuestion || rawTrimmed.slice(0, maxChars);
            // Personal facts (name, age, style...) go to the private profile; only the
            // clean question reaches the router, the LLM and the shared memory.
            const profileIntro = extractProfileFacts(rawTrimmed);
            const consentReply = this.userProfile ? detectConsentReply(rawTrimmed) : null;
            const routingText = profileIntro.isPureIntro
                ? profileIntro.greeting || (locale === 'en' ? 'hi' : 'oi')
                : profileIntro.cleanedText || rawTrimmed;
            const inspection =
                routingText === rawTrimmed
                    ? displayInspection
                    : this.promptSystem.inspectAndClassifyInput(routingText, maxChars, locale);
            const routingQuestion =
                inspection.sanitizedQuestion || routingText.slice(0, maxChars);

            const session = await this.resolveOrCreateSessionForMessage({
                userId: params.userId,
                sessionId: params.sessionId,
                accountId: params.accountId,
                firstMessageText: trimmed,
                locale,
            });

            const userMsg = await this.messageRepo.save(
                this.messageRepo.create({
                    sessionId: session.id,
                    role: 'user',
                    content: trimmed,
                    intent: inspection.category.toLowerCase(),
                    provider: 'client',
                    metadata: {},
                })
            );

            const job = await this.jobRepo.save(
                this.jobRepo.create({
                    userId: params.userId,
                    sessionId: session.id,
                    userMessageId: userMsg.id,
                    assistantMessageId: null,
                    status: 'PROCESSING',
                    creditsUsed: 0,
                })
            );

            this.pruneStalePresence();
            this.jobPresence.set(job.id, {
                userId: params.userId,
                away: false,
                lastVisiblePollAt: Date.now(),
                createdAt: Date.now(),
            });

            const capturedSession = session;
            setImmediate(() => {
                void this.runAsyncJob({
                    jobId: job.id,
                    userId: params.userId,
                    userName: params.userName,
                    accountId:
                        params.accountId || capturedSession.accountId || null,
                    session: capturedSession,
                    userMsg,
                    trimmedQuestion: routingQuestion,
                    inspection,
                    initialCreditStatus: creditStatus,
                    locale,
                    profileFacts: profileIntro.facts,
                    profileDiscarded: profileIntro.discarded,
                    consentReply,
                });
            });

            return {
                async: true as const,
                jobId: job.id,
                status: 'PROCESSING' as const,
                session,
                userMessage: userMsg,
                credits: creditStatus,
            };
        } catch (err) {
            this.logger.error(
                `[TorexAiChatService] Erro ao enfileirar mensagem assíncrona: ${(err as Error).message}`
            );
            return {
                async: false as const,
                status: 'COMPLETED' as const,
                ...this.buildEphemeralFallbackResponse(
                    params.userId,
                    rawTrimmed.slice(0, 50),
                    params.sessionId,
                    params.accountId,
                    locale
                ),
            };
        }
    }

    private async runAsyncJob(ctx: {
        jobId: string;
        userId: string;
        userName: string;
        accountId?: string | null;
        session: AiChatSessionEntity;
        userMsg: AiChatMessageEntity;
        trimmedQuestion: string;
        inspection: InputInspectionResult;
        initialCreditStatus: AiCreditStatusDto;
        locale?: 'pt' | 'en';
        profileFacts?: ProfileFact[];
        profileDiscarded?: string[];
        consentReply?: 'GRANT' | 'DENY' | 'FORGET' | null;
        traderProfileFacts?: string[];
    }) {
        const locale: 'pt' | 'en' = ctx.locale === 'en' ? 'en' : 'pt';
        try {
            const result = await this.generateWithProfile(ctx);

            // Atualiza o job apenas se a sessão não tiver sido excluída pelo utilizador durante o processamento
            const existingJob = await this.jobRepo.findOne({
                where: { id: ctx.jobId },
            });
            if (existingJob) {
                // Se um guarda de timeout já tinha fechado o job com o aviso de suporte,
                // a resposta real substitui-o: remove o aviso para não duplicar a conversa.
                const previousId = existingJob.assistantMessageId;
                if (previousId && previousId !== result.assistantMessage.id) {
                    await this.messageRepo
                        .delete({ id: previousId, sessionId: ctx.session.id, intent: 'support_fallback' })
                        .catch(() => undefined);
                }
                existingJob.assistantMessageId = result.assistantMessage.id;
                existingJob.creditsUsed = result.creditsUsed;
                existingJob.status = 'COMPLETED';
                await this.jobRepo.save(existingJob);

                const presence = this.jobPresence.get(ctx.jobId);
                this.jobPresence.delete(ctx.jobId);
                const userIsAway = Boolean(
                    presence &&
                        (presence.away || Date.now() - presence.lastVisiblePollAt > 15_000),
                );
                if (userIsAway && this.eventEmitter) {
                    this.eventEmitter.emit('ai.reply.ready_away', {
                        userId: ctx.userId,
                        sessionId: ctx.session.id,
                        jobId: ctx.jobId,
                        locale,
                    });
                }
            } else {
                this.jobPresence.delete(ctx.jobId);
            }
        } catch (err) {
            this.logger.error(
                `[TorexAiChatService] Erro crítico no job assíncrono ${ctx.jobId}: ${(err as Error).message}`
            );
            try {
                const existingJob = await this.jobRepo.findOne({
                    where: { id: ctx.jobId },
                });
                if (existingJob && existingJob.status === 'PROCESSING') {
                    const fbMsg = await this.messageRepo.save(
                        this.messageRepo.create({
                            sessionId: ctx.session.id,
                            role: 'assistant',
                            content:
                                locale === 'en'
                                    ? AI_SUPPORT_FALLBACK_MESSAGE_EN
                                    : AI_SUPPORT_FALLBACK_MESSAGE,
                            intent: 'support_fallback',
                            provider: 'system_guard',
                            metadata: {
                                creditsUsed: 0,
                                failureReason: 'JOB_CRASH',
                                failureDetail: String((err as Error)?.message || err).slice(0, 300),
                            },
                        })
                    );
                    existingJob.assistantMessageId = fbMsg.id;
                    existingJob.creditsUsed = 0;
                    existingJob.status = 'COMPLETED';
                    await this.jobRepo.save(existingJob);
                }
            } catch {
                // Evita unhandled rejection caso o banco esteja indisponível
            }
        }
    }

    async sendMessage(params: {
        userId: string;
        userName: string;
        question: string;
        sessionId?: string | null;
        accountId?: string | null;
        locale?: 'pt' | 'en';
    }) {
        const rawTrimmed = String(params.question || '').trim();
        // Reply in the language of the question; the UI locale only breaks ties.
        const locale: 'pt' | 'en' = detectQuestionLocale(
            rawTrimmed,
            params.locale === 'en' ? 'en' : 'pt'
        );
        if (!rawTrimmed) {
            throw new BadRequestException(locale === 'en' ? 'Empty message' : 'Mensagem vazia');
        }

        try {
            const creditStatus = await this.aiCreditsService.getCreditStatus(
                params.userId
            );
            const maxChars = creditStatus.maxMessageChars || 50;
            const displayInspection = this.promptSystem.inspectAndClassifyInput(
                rawTrimmed,
                maxChars,
                locale
            );
            // What the user typed stays in their conversation as written.
            const trimmed =
                displayInspection.sanitizedQuestion || rawTrimmed.slice(0, maxChars);
            // Personal facts (name, age, style...) go to the private profile; only the
            // clean question reaches the router, the LLM and the shared memory.
            const profileIntro = extractProfileFacts(rawTrimmed);
            const consentReply = this.userProfile ? detectConsentReply(rawTrimmed) : null;
            const routingText = profileIntro.isPureIntro
                ? profileIntro.greeting || (locale === 'en' ? 'hi' : 'oi')
                : profileIntro.cleanedText || rawTrimmed;
            const inspection =
                routingText === rawTrimmed
                    ? displayInspection
                    : this.promptSystem.inspectAndClassifyInput(routingText, maxChars, locale);
            const routingQuestion =
                inspection.sanitizedQuestion || routingText.slice(0, maxChars);

            const session = await this.resolveOrCreateSessionForMessage({
                userId: params.userId,
                sessionId: params.sessionId,
                accountId: params.accountId,
                firstMessageText: trimmed,
                locale,
            });

            const userMsg = await this.messageRepo.save(
                this.messageRepo.create({
                    sessionId: session.id,
                    role: 'user',
                    content: trimmed,
                    intent: inspection.category.toLowerCase(),
                    provider: 'client',
                    metadata: {},
                })
            );

            const result = await this.generateWithProfile({
                userId: params.userId,
                userName: params.userName,
                accountId: params.accountId,
                session,
                userMsg,
                trimmedQuestion: routingQuestion,
                inspection,
                initialCreditStatus: creditStatus,
                locale,
                profileFacts: profileIntro.facts,
                profileDiscarded: profileIntro.discarded,
                consentReply,
            });

            const refreshedSession =
                (await this.sessionRepo.findOne({
                    where: { id: session.id },
                })) || session;

            return {
                session: refreshedSession,
                userMessage: userMsg,
                assistantMessage: result.assistantMessage,
                creditsUsed: result.creditsUsed,
                credits: result.credits,
            };
        } catch (err) {
            this.logger.error(
                `[TorexAiChatService] Erro ao processar mensagem síncrona: ${(err as Error).message}`
            );
            return this.buildEphemeralFallbackResponse(
                params.userId,
                rawTrimmed.slice(0, 50),
                params.sessionId,
                params.accountId,
                locale
            );
        }
    }

    private isUuid(val: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            String(val || '').trim()
        );
    }

    async submitMessageFeedback(params: {
        userId: string;
        userName?: string;
        messageId: string;
        rating: number;
        reasonCode?: string | null;
        correctionNote?: string | null;
        locale?: 'pt' | 'en';
    }): Promise<{
        ok: true;
        messageId: string;
        userFeedback: AiMessageUserFeedback;
    }> {
        const messageId = String(params.messageId || '').trim();
        if (!this.isUuid(messageId)) {
            throw new BadRequestException('Invalid message ID');
        }

        const numericRating = Number(params.rating);
        if (numericRating !== 1 && numericRating !== -1) {
            throw new BadRequestException('Rating must be 1 or -1');
        }
        const rating: 1 | -1 = numericRating === 1 ? 1 : -1;

        const assistantMsg = await this.messageRepo.findOne({
            where: { id: messageId },
        });
        if (!assistantMsg || assistantMsg.role !== 'assistant') {
            throw new NotFoundException('Assistant message not found');
        }
        if (assistantMsg.intent === 'support_fallback') {
            throw new BadRequestException(
                'Feedback is disabled for fallback system messages'
            );
        }

        const session = await this.sessionRepo.findOne({
            where: { id: assistantMsg.sessionId, userId: params.userId },
        });
        if (!session) {
            throw new NotFoundException('Chat session not found for user');
        }

        const rawReason = String(params.reasonCode || '')
            .trim()
            .toUpperCase();
        const reasonCode = (ALLOWED_FEEDBACK_REASON_CODES as readonly string[]).includes(
            rawReason
        )
            ? rawReason
            : rating === 1
            ? 'HELPFUL'
            : 'OTHER';

        const rawNote = String(params.correctionNote || '').trim();
        const cleanNote = rawNote
            ? this.privacySanitizer
                ? this.privacySanitizer.sanitizeTextForTraining(rawNote, {
                      userNames: params.userName ? [params.userName] : [],
                      maxLen: 240,
                  }).cleanText
                : rawNote.slice(0, 240)
            : null;

        const precedingUserMsgs = await this.messageRepo.find({
            where: {
                sessionId: session.id,
                role: 'user',
                createdAt: LessThanOrEqual(assistantMsg.createdAt),
            },
            order: { createdAt: 'DESC' },
            take: 1,
        });
        const question = String(precedingUserMsgs[0]?.content || '').trim();
        const normalizedQuestion = this.promptSystem.normalizeLookup(question);
        const locale: 'pt' | 'en' = params.locale === 'en' ? 'en' : 'pt';
        const meta = assistantMsg.metadata || {};

        let feedbackId = '';
        try {
            const upsertRes = await this.dataSource.query(
                `
                INSERT INTO ai_message_feedback (
                    message_id, session_id, user_id, rating, reason_code, correction_note,
                    locale, domain_category, intent, router_decision, router_model, analyst_model,
                    semantic_memory_id, matched_anchor_key, normalized_question
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT (message_id, user_id) DO UPDATE
                SET rating = EXCLUDED.rating,
                    reason_code = EXCLUDED.reason_code,
                    correction_note = EXCLUDED.correction_note,
                    updated_at = now()
                RETURNING id
                `,
                [
                    assistantMsg.id,
                    session.id,
                    params.userId,
                    rating,
                    reasonCode,
                    cleanNote,
                    locale,
                    meta.domainCategory || null,
                    assistantMsg.intent || null,
                    meta.routerDecision || null,
                    meta.routerModel || null,
                    meta.analystModel || null,
                    meta.semanticMemoryId || null,
                    meta.matchedAnchorKey || null,
                    normalizedQuestion || null,
                ]
            );
            const rows = Array.isArray(upsertRes)
                ? upsertRes
                : Array.isArray(upsertRes?.rows)
                ? upsertRes.rows
                : [];
            feedbackId = rows[0]?.id ? String(rows[0].id) : '';
        } catch (err) {
            this.logger.warn(
                `submitMessageFeedback DB upsert warning: ${(err as Error).message}`
            );
        }

        const userFeedback: AiMessageUserFeedback = {
            rating,
            reasonCode,
            correctionNote: cleanNote,
            updatedAtIso: new Date().toISOString(),
        };

        assistantMsg.metadata = {
            ...(assistantMsg.metadata || {}),
            userFeedback,
        };
        await this.messageRepo.save(assistantMsg);

        if (rating === -1) {
            await this.replyStore.invalidateUser(params.userId).catch(() => undefined);
        }

        this.eventEmitter?.emit('ai.feedback.recorded', {
            feedbackId,
            userId: params.userId,
            userName: params.userName,
            sessionId: session.id,
            messageId: assistantMsg.id,
            rating,
            reasonCode,
            correctionNote: cleanNote,
            locale,
            question,
            normalizedQuestion,
            reply: assistantMsg.content,
            intent: assistantMsg.intent,
            provider: assistantMsg.provider,
            metadata: assistantMsg.metadata,
        });

        return {
            ok: true,
            messageId: assistantMsg.id,
            userFeedback,
        };
    }

    async removeMessageFeedback(params: {
        userId: string;
        messageId: string;
    }): Promise<{ ok: true; removed: true; messageId: string }> {
        const messageId = String(params.messageId || '').trim();
        if (!this.isUuid(messageId)) {
            throw new BadRequestException('Invalid message ID');
        }

        const assistantMsg = await this.messageRepo.findOne({
            where: { id: messageId },
        });
        if (!assistantMsg || assistantMsg.role !== 'assistant') {
            throw new NotFoundException('Assistant message not found');
        }

        const session = await this.sessionRepo.findOne({
            where: { id: assistantMsg.sessionId, userId: params.userId },
        });
        if (!session) {
            throw new NotFoundException('Chat session not found for user');
        }

        try {
            await this.dataSource.query(
                `DELETE FROM ai_message_feedback WHERE message_id = $1 AND user_id = $2`,
                [assistantMsg.id, params.userId]
            );
        } catch {
            // Non-blocking cleanup if table absent
        }

        assistantMsg.metadata = {
            ...(assistantMsg.metadata || {}),
            userFeedback: null,
        };
        await this.messageRepo.save(assistantMsg);

        return {
            ok: true,
            removed: true,
            messageId: assistantMsg.id,
        };
    }
}
