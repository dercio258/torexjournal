import { EventEmitter2 } from '@nestjs/event-emitter';
import { of, throwError } from 'rxjs';
import { JournalService } from '../dashboard/journal.service';
import { AiController } from './ai.controller';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { AiLlmProviderService } from './ai-llm-provider.service';
import { AiPromptSystemService } from './ai-prompt-system.service';
import { AiRagService } from './ai-rag.service';
import { AiRouterService } from './ai-router.service';
import { AiSemanticIntentRouterService } from './ai-semantic-intent-router.service';
import {
    AI_EMBEDDING_DIMENSIONS,
    ALLOWED_RAG_SOURCE_TYPES,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
} from './ai-vector-schema';
import { TorexAiChatService } from './torex-ai-chat.service';

const makeUnitVec = (index = 0): number[] => {
    const vec = new Array(AI_EMBEDDING_DIMENSIONS).fill(0);
    vec[index % AI_EMBEDDING_DIMENSIONS] = 1;
    return vec;
};

describe('Phase 5 — Credential Resilience, Qwen PLATFORM_DOC RAG & Architecture Health', () => {
    it('1. AiEmbeddingService trips reactive API_KEY_INVALID circuit breaker, breaks batch loop and auto-recovers on key rotation', async () => {
        const env: Record<string, string> = {
            GEMINI_API_KEY: 'invalid-23-char-mock-k1',
            GEMINI_EMBEDDING_MODEL: DEFAULT_GEMINI_EMBEDDING_MODEL,
        };
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as any;

        const invalidKeyError = {
            response: {
                status: 400,
                data: {
                    error: {
                        status: 'INVALID_ARGUMENT',
                        message: 'API key not valid. Please pass a valid API key.',
                        details: [{ reason: 'API_KEY_INVALID' }],
                    },
                },
            },
        };

        const httpPost = jest.fn<any, any[]>(() => throwError(() => invalidKeyError));
        const httpService = { post: httpPost } as any;

        const embeddingService = new AiEmbeddingService(configService, httpService);

        expect(embeddingService.getStatus().enabled).toBe(true);
        const firstAttempt = await embeddingService.embedText('como importar trades?');
        expect(firstAttempt).toBeNull();
        expect(httpPost).toHaveBeenCalledTimes(1);

        const trippedStatus = embeddingService.getStatus();
        expect(trippedStatus.enabled).toBe(false);
        expect(trippedStatus.provider).toBe('none');
        expect(trippedStatus.disabledReason).toBe('API_KEY_INVALID');

        // Chamadas subsequentes com a mesma chave não devem bater na API Google
        const secondAttempt = await embeddingService.embedText('segunda pergunta');
        expect(secondAttempt).toBeNull();
        expect(httpPost).toHaveBeenCalledTimes(1);

        // Em lote grande (> 50 itens) num instância limpa, deve interromper no 1.º chunk ao receber API_KEY_INVALID
        const batchHttpPost = jest.fn(() => throwError(() => invalidKeyError));
        const batchService = new AiEmbeddingService(configService, {
            post: batchHttpPost,
        } as any);
        const batchItems = Array.from({ length: 65 }, (_, idx) => ({
            text: `Nota única número ${idx}`,
            taskType: 'RETRIEVAL_DOCUMENT' as const,
            skipCache: true,
        }));
        const batchRes = await batchService.embedBatch(batchItems);
        expect(batchRes).toHaveLength(65);
        expect(batchRes.every((r) => r === null)).toBe(true);
        expect(batchHttpPost).toHaveBeenCalledTimes(1);
        expect(batchService.getStatus().disabledReason).toBe('API_KEY_INVALID');

        // Rotação para uma chave válida deve reativar automaticamente o serviço sem reiniciar o servidor
        env.GEMINI_API_KEY = 'AIzaValidRotatedKeyForPhase5Verification001';
        httpPost.mockImplementation(() =>
            of({
                data: {
                    embedding: { values: makeUnitVec(0) },
                },
            } as any)
        );

        const recoveredStatus = embeddingService.getStatus();
        expect(recoveredStatus.enabled).toBe(true);
        expect(recoveredStatus.disabledReason).toBeUndefined();

        const recoveredResult = await embeddingService.embedText('pergunta recuperada');
        expect(recoveredResult).not.toBeNull();
        expect(recoveredResult?.dimensions).toBe(AI_EMBEDDING_DIMENSIONS);
        expect(httpPost).toHaveBeenCalledTimes(2);
    });

    it('2. AiLlmProviderService trips reactive API_KEY_INVALID breaker for Gemini Analyst and recovers on key change', async () => {
        const env: Record<string, string> = {
            GEMINI_API_KEY: 'invalid-23-char-mock-k2',
        };
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as any;

        const httpPost = jest.fn<any, any[]>(() =>
            throwError(() => ({
                response: {
                    status: 400,
                    data: {
                        error: {
                            status: 'INVALID_ARGUMENT',
                            message: 'API key not valid. Please pass a valid API key.',
                            details: [{ reason: 'API_KEY_INVALID' }],
                        },
                    },
                },
            }))
        );

        const llmProvider = new AiLlmProviderService(configService, {
            post: httpPost,
        } as any);

        expect(llmProvider.getDualEngineStatus().geminiEnabled).toBe(true);

        const first = await llmProvider.generateGeminiAnalysis({
            systemPrompt: 'sys',
            userTaskPrompt: 'task',
            history: [],
        });
        expect(first?.failed).toBe(true);
        expect(httpPost).toHaveBeenCalledTimes(1);

        const afterTrip = llmProvider.getDualEngineStatus();
        expect(afterTrip.geminiEnabled).toBe(false);
        expect(afterTrip.geminiDisabledReason).toBe('API_KEY_INVALID');

        // Nova chamada com a mesma chave inválida retorna falha sem chamar HTTP novamente
        const blockedCall = await llmProvider.generateGeminiAnalysis({
            systemPrompt: 'sys',
            userTaskPrompt: 'task 2',
            history: [],
        });
        expect(blockedCall).toBeNull();
        expect(httpPost).toHaveBeenCalledTimes(1);

        // Troca de chave restaura o motor Gemini automaticamente
        env.GEMINI_API_KEY = 'AIzaValidRotatedKeyForGeminiAnalyst0000002';
        httpPost.mockImplementation(() =>
            of({
                data: {
                    candidates: [
                        { content: { parts: [{ text: 'Análise validada com sucesso.' }] } },
                    ],
                },
            } as any)
        );

        const restoredStatus = llmProvider.getDualEngineStatus();
        expect(restoredStatus.geminiEnabled).toBe(true);
        expect(restoredStatus.geminiDisabledReason).toBeUndefined();

        const recovered = await llmProvider.generateGeminiAnalysis({
            systemPrompt: 'sys',
            userTaskPrompt: 'task 3',
            history: [],
        });
        expect(recovered?.text).toBe('Análise validada com sucesso.');
        expect(httpPost).toHaveBeenCalledTimes(2);
    });

    it('3. AiRouterService injects sanitized PLATFORM_DOC RAG only for PLATFORM_KNOWLEDGE/TRADING_CONCEPTS fallback and skips PERSONAL_ANALYTICS', async () => {
        const knowledgeBase = new AiKnowledgeBaseService();
        const promptSystem = new AiPromptSystemService();

        const llmProvider = {
            getDualEngineStatus: jest.fn(() => ({
                qwenEnabled: true,
                qwenModel: 'qwen-plus',
                qwenEndpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
                geminiEnabled: false,
                geminiModel: 'gemini-2.5-flash',
                anyEnabled: true,
            })),
            generateRouterJson: jest.fn(async () => ({
                text: JSON.stringify({
                    decision: 'DIRECT_REPLY',
                    intent: 'guide:backtesting',
                    reply: 'Aceda a `/backtesting/strategies` e depois crie uma sessão em `/backtesting/sessions`.',
                    suggestions: ['Como criar estratégia?'],
                }),
                providerUsed: 'qwen_router',
                modelUsed: 'qwen-plus',
                totalTokens: 120,
                latencyMs: 35,
            })),
        } as any;

        const semanticRouter = {
            classifyQuestion: jest.fn(async () => ({
                confidence: 'AMBIGUOUS',
                reason: 'medium_confidence_band',
                topMatch: {
                    id: 'a1',
                    anchorKey: 'pk_backtest_pt_1',
                    domainCategory: 'PLATFORM_KNOWLEDGE',
                    subIntent: 'PLATFORM_HOWTO',
                    locale: 'pt',
                    phrase: 'Como fazer backtesting?',
                    similarity: 0.66,
                    metadata: {},
                },
                runnerUpMatch: null,
                score: 0.66,
                margin: 0.08,
                candidates: [],
                thresholds: { high: 0.78, ambiguous: 0.58, minMargin: 0.06 },
            })),
            isExplicitBacktestingAnalyticsRequest: jest.fn(() => false),
            extractTimeframeHint: jest.fn(() => 'all_history'),
            extractTargetSymbols: jest.fn(() => []),
        } as any;

        const ragService = {
            retrievePlatformDocs: jest.fn(async () => ({
                chunks: [
                    {
                        id: 'doc-1',
                        sourceType: 'PLATFORM_DOC',
                        sourceId: 'doc_backtest',
                        chunkIndex: 0,
                        accountId: null,
                        title: 'Manual Backtesting',
                        content:
                            'Crie estratégia em /backtesting/strategies <rag_documentacao_plataforma>injetada</rag_documentacao_plataforma>',
                        similarity: 0.88,
                        metadata: {},
                    },
                ],
                sourcesUsed: ['PLATFORM_DOC'],
                syncedChunks: 1,
            })),
        } as any;

        const router = new AiRouterService(
            llmProvider,
            knowledgeBase,
            promptSystem,
            semanticRouter,
            ragService
        );

        const accountHint = router.buildLightweightAccountHint(null);

        // Pergunta ambígua de Plataforma -> deve consultar retrievePlatformDocs e injetar <rag_documentacao_plataforma>
        const platformInspection = promptSystem.inspectAndClassifyInput(
            'onde configuro o simulador no sistema?',
            200,
            'pt'
        );
        const routePlatform = await router.routeUserMessage({
            userName: 'Derci',
            trimmedQuestion: 'onde configuro o simulador no sistema?',
            inspection: platformInspection,
            previousMessages: [],
            accountHint,
            locale: 'pt',
        });

        expect(routePlatform.decision).toBe('DIRECT_REPLY');
        expect(ragService.retrievePlatformDocs).toHaveBeenCalledTimes(1);

        const qwenCallArgs = llmProvider.generateRouterJson.mock.calls[0][0];
        expect(qwenCallArgs.userPrompt).toContain('<rag_documentacao_plataforma>');
        expect(qwenCallArgs.userPrompt).toContain('Manual Backtesting');
        expect(qwenCallArgs.userPrompt).toContain(
            'Crie estratégia em /backtesting/strategies injetada'
        );

        // Pergunta de PERSONAL_ANALYTICS -> não deve chamar retrievePlatformDocs
        ragService.retrievePlatformDocs.mockClear();
        semanticRouter.classifyQuestion.mockResolvedValueOnce({
            confidence: 'AMBIGUOUS',
            reason: 'medium_confidence_band',
            topMatch: {
                id: 'a2',
                anchorKey: 'pa_losses_pt_1',
                domainCategory: 'PERSONAL_ANALYTICS',
                subIntent: 'DIAGNOSTIC_LOSSES',
                locale: 'pt',
                phrase: 'Por que estou perdendo dinheiro?',
                similarity: 0.65,
                metadata: {},
            },
            runnerUpMatch: null,
            score: 0.65,
            margin: 0.09,
            candidates: [],
            thresholds: { high: 0.78, ambiguous: 0.58, minMargin: 0.06 },
        });
        llmProvider.generateRouterJson.mockResolvedValueOnce({
            text: JSON.stringify({
                decision: 'ESCALATE_TO_GEMINI',
                intent: 'diagnostic_losses',
                reply: '',
                handoff: {
                    formalizedQuestion: 'Por que tive prejuízo em XAUUSD?',
                    analyticalObjective: 'Auditar perdas recentes em XAUUSD',
                    subIntent: 'DIAGNOSTIC_LOSSES',
                    targetSymbols: ['XAUUSD'],
                    timeframeHint: 'recent_7d',
                    includeJournalNotes: true,
                    includePlaybookRules: true,
                    focusMetrics: ['net_pnl', 'winrate'],
                },
            }),
            providerUsed: 'qwen_router',
            modelUsed: 'qwen-plus',
            latencyMs: 30,
        });

        const analyticsInspection = promptSystem.inspectAndClassifyInput(
            'por que meu lucro caiu em XAUUSD esta semana?',
            200,
            'pt'
        );
        const routeAnalytics = await router.routeUserMessage({
            userName: 'Derci',
            trimmedQuestion: 'por que meu lucro caiu em XAUUSD esta semana?',
            inspection: analyticsInspection,
            previousMessages: [],
            accountHint: { ...accountHint, hasData: true, totalTrades: 20 },
            locale: 'pt',
        });

        expect(routeAnalytics.decision).toBe('ESCALATE_TO_GEMINI');
        expect(ragService.retrievePlatformDocs).not.toHaveBeenCalled();

        // Pós-filtro remove eventual eco da tag <rag_documentacao_plataforma>
        expect(
            promptSystem.verifyModelOutput(
                '<rag_documentacao_plataforma>Use /backtesting</rag_documentacao_plataforma>'
            )
        ).toBe('Use /backtesting');
    });

    it('4. AiRagService resets 60s user sync throttle via invalidateUserSyncCache and JournalService EventEmitter events', async () => {
        const dsQuery = jest.fn(async () => []);
        const dataSource = { isInitialized: true, query: dsQuery } as any;
        const embeddingService = {
            getStatus: jest.fn(() => ({ enabled: true, provider: 'gemini', model: 'gemini-embedding-2', fallbackModel: 'gemini-embedding-2-preview', dimensions: AI_EMBEDDING_DIMENSIONS })),
            embedBatch: jest.fn(async (items: any[]) =>
                items.map(() => ({
                    values: makeUnitVec(0),
                    model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                    dimensions: AI_EMBEDDING_DIMENSIONS,
                    contentHash: 'h',
                    cached: false,
                }))
            ),
        } as any;
        const vectorStore = {
            ensureInitialized: jest.fn(async () => ({
                initialized: true,
                backend: 'pgvector',
                dimensions: AI_EMBEDDING_DIMENSIONS,
            })),
            getExistingRagChunkHashes: jest.fn(async () => new Map()),
            upsertRagChunks: jest.fn(async () => 0),
            deleteStaleRagChunks: jest.fn(async () => 0),
        } as any;

        const ragService = new AiRagService(
            embeddingService,
            vectorStore,
            new AiKnowledgeBaseService(),
            new AiPromptSystemService(),
            dataSource
        );

        const eventEmitter = new EventEmitter2();
        eventEmitter.on('ai.rag.invalidate_user', (payload) =>
            ragService.handleUserRagInvalidation(payload)
        );

        const emptyRepo = () => ({ delete: jest.fn(async () => ({})), save: jest.fn(async (x: any) => x), findOne: jest.fn(), create: jest.fn((x: any) => x) }) as any;
        const journalService = new JournalService(
            dataSource,
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            emptyRepo(),
            { get: jest.fn(), set: jest.fn() } as any,
            {} as any,
            eventEmitter
        );

        // 1.ª sincronização consulta o banco
        await ragService.syncUserQualitativeSources('user-rag-1');
        const callsAfterFirstSync = dsQuery.mock.calls.length;
        expect(callsAfterFirstSync).toBeGreaterThan(0);

        // 2.ª sincronização imediata cai no throttle de 60s
        await ragService.syncUserQualitativeSources('user-rag-1');
        expect(dsQuery.mock.calls.length).toBe(callsAfterFirstSync);

        // Invalidação direta limpa o throttle imediatamente
        ragService.invalidateUserSyncCache('user-rag-1');
        await ragService.syncUserQualitativeSources('user-rag-1');
        expect(dsQuery.mock.calls.length).toBe(callsAfterFirstSync * 2);

        // Ao alterar/remover nota no JournalService, evento ai.rag.invalidate_user limpa novamente o throttle
        await journalService.deleteGeneralNote('user-rag-1', 'note-1');
        await ragService.syncUserQualitativeSources('user-rag-1');
        expect(dsQuery.mock.calls.length).toBe(callsAfterFirstSync * 3);
    });

    it('5. TorexAiChatService.getArchitectureHealth & AiController.getArchitectureStatus expose sanitized full-architecture telemetry', async () => {
        const embeddingMock = {
            getStatus: jest.fn(() => ({
                enabled: false,
                provider: 'none' as const,
                model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                fallbackModel: 'gemini-embedding-2-preview',
                dimensions: AI_EMBEDDING_DIMENSIONS,
                disabledReason: 'API_KEY_INVALID' as const,
            })),
        } as any;
        const vectorStoreMock = {
            getStatus: jest.fn(() => ({
                initialized: true,
                backend: 'pgvector' as const,
                dimensions: AI_EMBEDDING_DIMENSIONS,
            })),
        } as any;
        const semanticRouterMock = {
            getStatus: jest.fn(() => ({
                enabled: false,
                anchorsSynced: false,
                totalSeedAnchors: 22,
                categories: [
                    'TRADING_CONCEPTS',
                    'PLATFORM_KNOWLEDGE',
                    'PERSONAL_ANALYTICS',
                ] as const,
                thresholds: { high: 0.78, ambiguous: 0.58, minMargin: 0.06 },
            })),
        } as any;
        const ragMock = {
            getStatus: jest.fn(() => ({
                enabled: false,
                platformDocsSynced: false,
                cachedUsersCount: 0,
                allowedSources: [...ALLOWED_RAG_SOURCE_TYPES],
            })),
        } as any;
        const llmMock = {
            getDualEngineStatus: jest.fn(() => ({
                qwenEnabled: true,
                qwenModel: 'qwen-plus',
                qwenEndpoint: 'https://secret-internal-proxy.example.com/v1/chat/completions?token=secret123',
                qwenWorkspaceConfigured: true,
                qwenRegion: 'ap-southeast-1',
                geminiEnabled: false,
                geminiModel: 'gemini-2.5-flash',
                geminiDisabledReason: 'API_KEY_INVALID' as const,
                anyEnabled: true,
            })),
        } as any;

        const chatService = new TorexAiChatService(
            { query: jest.fn() } as any,
            {} as any,
            {} as any,
            {} as any,
            new AiKnowledgeBaseService(),
            {} as any,
            llmMock,
            {} as any,
            new AiPromptSystemService(),
            {} as any,
            {} as any,
            ragMock,
            embeddingMock,
            vectorStoreMock,
            semanticRouterMock
        );

        const controller = new AiController(
            {} as any,
            chatService,
            {} as any,
            {} as any,
            {} as any
        );

        const health = controller.getArchitectureStatus();
        expect(health.securityShield).toEqual({
            enabled: true,
            independentOfSemanticClassifier: true,
        });
        expect(health.embedding.disabledReason).toBe('API_KEY_INVALID');
        expect(health.vectorStore.backend).toBe('pgvector');
        expect(health.semanticRouter.totalSeedAnchors).toBe(22);
        expect(health.semanticRouter.qwenAmbiguousFallback).toBe(true);
        expect(health.models.qwenRouter).toEqual({
            enabled: true,
            model: 'qwen-plus',
            workspaceConfigured: true,
            region: 'ap-southeast-1',
            customEndpointConfigured: true,
        });
        expect(health.models.geminiAnalyst).toEqual({
            enabled: false,
            model: 'gemini-2.5-flash',
            disabledReason: 'API_KEY_INVALID',
        });
        expect(health.deterministicAnalytics).toEqual({
            enabled: true,
            rawTradeHistorySentToLlm: false,
            backtestingExcludedByDefault: true,
            tools: [
                'sql_window_kpis',
                'sql_directional_split',
                'sql_symbol_and_setup_matrix',
                'sql_session_and_weekday_matrix',
                'sql_backtesting_summary',
            ],
        });
        expect(health.scopedRag.allowedSources).toEqual([
            'PLATFORM_DOC',
            'DAILY_NOTE',
            'TRADE_NOTE',
            'GENERAL_NOTE',
            'TRADE_LESSON',
            'PLAYBOOK',
        ]);

        // Garantir que nenhuma URL bruta, token ou chave secreta vaza no JSON de diagnóstico
        const serialized = JSON.stringify(health);
        expect(serialized).not.toContain('secret-internal-proxy.example.com');
        expect(serialized).not.toContain('token=secret123');
    });

    it('6. AiLlmProviderService supports QWEN_WORKSPACE_ID, QWEN_REGION, base_url normalization and isolates IA_ENDPOINT', async () => {
        const env: Record<string, string | undefined> = {
            QWEN_API_KEY: 'sk-qwen-workspace-test-001',
            QWEN_WORKSPACE_ID: 'ws-abc123',
            QWEN_REGION: 'ap-southeast-1',
            IA_ENDPOINT: 'https://legacy-broken.example.com/v1/chat/completions',
        };
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as any;

        const httpPost = jest.fn<any, any[]>(() =>
            of({
                data: {
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    decision: 'DIRECT_REPLY',
                                    intent: 'guide_ok',
                                    reply: 'Ok',
                                }),
                            },
                        },
                    ],
                },
            } as any)
        );

        const llmProvider = new AiLlmProviderService(configService, {
            post: httpPost,
        } as any);

        // 1) Usa automaticamente MaaS workspace URL ignorando IA_ENDPOINT legado
        await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping',
            history: [],
        });
        expect(httpPost).toHaveBeenCalledTimes(1);
        expect(httpPost.mock.calls[0][0]).toBe(
            'https://ws-abc123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
        );
        expect(httpPost.mock.calls[0][2].headers['X-DashScope-WorkSpace']).toBeUndefined();
        expect(llmProvider.getDualEngineStatus().qwenWorkspaceConfigured).toBe(true);
        expect(llmProvider.getDualEngineStatus().qwenRegion).toBe('ap-southeast-1');

        // 2) Normaliza URL base copiada da documentação com {WorkspaceId} e sem /chat/completions
        env.QWEN_API_ENDPOINT =
            'https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1';
        await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping 2',
            history: [],
        });
        expect(httpPost).toHaveBeenCalledTimes(2);
        expect(httpPost.mock.calls[1][0]).toBe(
            'https://ws-abc123.us-east-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
        );

        // 3) Endpoint DashScope partilhado com sub-workspace envia X-DashScope-WorkSpace e acrescenta /chat/completions
        env.QWEN_API_ENDPOINT =
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
        env.QWEN_WORKSPACE_ID = 'ws-sub99';
        await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping 3',
            history: [],
        });
        expect(httpPost).toHaveBeenCalledTimes(3);
        expect(httpPost.mock.calls[2][0]).toBe(
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
        );
        expect(httpPost.mock.calls[2][2].headers['X-DashScope-WorkSpace']).toBe(
            'ws-sub99'
        );

        // 4) Sem QWEN_API_ENDPOINT nem QWEN_WORKSPACE_ID, usa o endpoint padrão QwenCloud por região
        delete env.QWEN_API_ENDPOINT;
        delete env.QWEN_WORKSPACE_ID;
        env.QWEN_REGION = 'ap-southeast-1';
        await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping 4',
            history: [],
        });
        expect(httpPost).toHaveBeenCalledTimes(4);
        expect(httpPost.mock.calls[3][0]).toBe(
            'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions'
        );

        env.QWEN_REGION = 'us-east-1';
        await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping 5',
            history: [],
        });
        expect(httpPost).toHaveBeenCalledTimes(5);
        expect(httpPost.mock.calls[4][0]).toBe(
            'https://us-east-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions'
        );
    });

    it('7. AiLlmProviderService ignores non-ws QWEN_WORKSPACE_ID display names, self-heals 400 workspace endpoint errors, and falls back across Gemini 404/503 models', async () => {
        const env: Record<string, string | undefined> = {
            QWEN_API_KEY: 'sk-ws-live-test-key',
            QWEN_WORKSPACE_ID: 'torexj',
            QWEN_REGION: 'ap-southeast-1',
            GEMINI_API_KEY: 'AIzaValidKeyForFallbackTest00000000001',
            GEMINI_MODEL: 'gemini-2.5-flash',
        };
        const configService = {
            get: jest.fn((key: string) => env[key]),
        } as any;

        const httpPost = jest.fn<any, any[]>((url: string) => {
            if (url.includes('ws-broken.ap-southeast-1.maas.aliyuncs.com')) {
                return throwError(() => ({
                    response: {
                        status: 400,
                        data: {
                            error: {
                                code: 'invalid_parameter_error',
                                message: 'Workspace endpoint is invalid.',
                            },
                        },
                    },
                }));
            }
            if (url.includes('ap-southeast-1.maas.qwencloudapi.com')) {
                return of({
                    data: {
                        choices: [
                            {
                                message: {
                                    content: JSON.stringify({
                                        decision: 'DIRECT_REPLY',
                                        intent: 'guide_ok',
                                        reply: 'Resposta via Qwen regional.',
                                    }),
                                },
                            },
                        ],
                    },
                } as any);
            }
            if (url.includes('gemini-2.5-flash:generateContent')) {
                return throwError(() => ({
                    response: {
                        status: 503,
                        data: { error: { status: 'UNAVAILABLE', message: 'High demand' } },
                    },
                }));
            }
            if (url.includes('gemini-2.5-flash-lite:generateContent')) {
                return of({
                    data: {
                        candidates: [
                            { content: { parts: [{ text: 'Análise via gemini-2.5-flash-lite.' }] } },
                        ],
                    },
                } as any);
            }
            return throwError(() => new Error(`Unexpected URL: ${url}`));
        });

        const llmProvider = new AiLlmProviderService(configService, {
            post: httpPost,
        } as any);

        // 1) Display name "torexj" é ignorado e vai direto para endpoint regional QwenCloud
        const routerRes1 = await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping torexj',
            history: [],
        });
        expect(routerRes1?.providerUsed).toBe('qwen_router');
        expect(httpPost).toHaveBeenCalledTimes(1);
        expect(httpPost.mock.calls[0][0]).toBe(
            'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions'
        );
        expect(llmProvider.getDualEngineStatus().qwenWorkspaceConfigured).toBe(false);

        // 2) ID ws- inválido em produção (HTTP 400) ativa fallback imediato e fica bypassado nas chamadas seguintes
        env.QWEN_WORKSPACE_ID = 'ws-broken';
        const routerRes2 = await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping ws-broken',
            history: [],
        });
        expect(routerRes2?.providerUsed).toBe('qwen_router');
        expect(httpPost).toHaveBeenCalledTimes(3); // 1 failure on ws-broken + 1 immediate regional retry
        expect(httpPost.mock.calls[1][0]).toBe(
            'https://ws-broken.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
        );
        expect(httpPost.mock.calls[2][0]).toBe(
            'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions'
        );

        const routerRes3 = await llmProvider.generateRouterJson({
            systemPrompt: 'sys',
            userPrompt: 'ping after bypass',
            history: [],
        });
        expect(routerRes3?.providerUsed).toBe('qwen_router');
        expect(httpPost).toHaveBeenCalledTimes(4);
        expect(httpPost.mock.calls[3][0]).toBe(
            'https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1/chat/completions'
        );

        // 3) Gemini 503 (gemini-2.5-flash) cai para gemini-2.5-flash-lite usando header x-goog-api-key (sem ?key= na URL)
        const analystRes = await llmProvider.generateGeminiAnalysis({
            systemPrompt: 'sys',
            userTaskPrompt: 'analyze',
            history: [],
        });
        expect(analystRes?.providerUsed).toBe('llm:gemini');
        expect(analystRes?.modelUsed).toBe('gemini-2.5-flash-lite');
        expect(analystRes?.text).toBe('Análise via gemini-2.5-flash-lite.');
        expect(llmProvider.getDualEngineStatus().geminiModel).toBe('gemini-2.5-flash');
        const geminiCall = httpPost.mock.calls.find((c) => String(c[0]).includes('generativelanguage.googleapis.com'));
        expect(geminiCall?.[0]).not.toContain('key=');
        expect(geminiCall?.[2]?.headers?.['x-goog-api-key']).toBe('AIzaValidKeyForFallbackTest00000000001');
    });
});
