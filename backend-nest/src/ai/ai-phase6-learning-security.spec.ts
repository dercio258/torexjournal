import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AiAutoLearningService } from './ai-auto-learning.service';
import { AiKnowledgeBaseService } from './ai-knowledge-base.service';
import { GLOBAL_MEMORY_OWNER_SCOPE } from './ai-learning-schema';
import { AiPrivacySanitizerService } from './ai-privacy-sanitizer.service';
import { AiPromptSystemService } from './ai-prompt-system.service';
import { AiRouterService } from './ai-router.service';
import { AiSemanticMemoryService } from './ai-semantic-memory.service';
import { AiTrainingReportService } from './ai-training-report.service';
import { TorexAiChatService } from './torex-ai-chat.service';

interface InMemoryStore {
    memories: any[];
    synonyms: any[];
    feedbacks: any[];
    messages: any[];
}

function createMockLearningDataSource(store: InMemoryStore) {
    return {
        query: jest.fn(async (sqlRaw: string, params: any[] = []) => {
            const sql = sqlRaw.replace(/\s+/g, ' ').trim();

            if (/SELECT extname FROM pg_extension/i.test(sql)) {
                return [];
            }

            if (/CREATE TABLE|CREATE INDEX|ALTER TABLE|CREATE OR REPLACE|DO \$\$/i.test(sql)) {
                return [];
            }

            if (/UPDATE ai_semantic_memory SET status = 'RETIRED'/i.test(sql)) {
                return [];
            }

            if (/INSERT INTO ai_lexical_synonyms/i.test(sql)) {
                const normSurface = params[1];
                const canonical = params[2];
                const locale = sql.includes('seed') ? params[5] : params[5] || 'pt';
                const exists = store.synonyms.find(
                    (s) =>
                        s.locale === locale &&
                        s.normalized_surface === normSurface &&
                        s.canonical_term === canonical
                );
                if (!exists) {
                    store.synonyms.push({
                        id: randomUUID(),
                        surface_term: params[0],
                        normalized_surface: normSurface,
                        canonical_term: canonical,
                        intent_key: params[3] || null,
                        domain_category: params[4] || null,
                        locale: params[5] || 'pt',
                        co_occurrence_count: 1,
                        positive_weight: 1.2,
                        is_active: true,
                    });
                }
                return [];
            }

            if (/FROM ai_lexical_synonyms WHERE is_active = true/i.test(sql)) {
                return store.synonyms;
            }

            if (/SELECT \* FROM ai_semantic_memory WHERE id = \$1/i.test(sql)) {
                const found = store.memories.find((m) => m.id === params[0]);
                return found ? [found] : [];
            }

            if (/SELECT \* FROM ai_semantic_memory WHERE owner_scope = \$1 AND scope_level = \$2/i.test(sql)) {
                return store.memories.filter(
                    (m) =>
                        m.owner_scope === params[0] &&
                        m.scope_level === params[1] &&
                        m.locale === params[2] &&
                        m.domain_category === params[3]
                );
            }

            if (/SELECT \* FROM ai_semantic_memory WHERE status = 'ACTIVE' AND locale = \$1/i.test(sql)) {
                const allowedOwners = Array.isArray(params[1]) ? params[1] : [params[1]];
                return store.memories.filter(
                    (m) =>
                        m.status === 'ACTIVE' &&
                        m.locale === params[0] &&
                        allowedOwners.includes(m.owner_scope)
                );
            }

            if (/INSERT INTO ai_semantic_memory/i.test(sql)) {
                const isPattern = sql.includes("'GLOBAL_INTENT_PATTERN'");
                const newRow = isPattern
                    ? {
                          id: randomUUID(),
                          scope_level: 'GLOBAL_INTENT_PATTERN',
                          owner_scope: params[0],
                          user_id: null,
                          account_id: null,
                          locale: params[1],
                          domain_category: 'PERSONAL_ANALYTICS',
                          sub_intent: params[2],
                          intent_key: params[3],
                          canonical_question: params[4],
                          normalized_question: params[5],
                          content_hash: params[6],
                          variant_phrases: JSON.parse(params[7]),
                          embedding_model: params[8],
                          dimensions: params[9],
                          embedding_f64: params[10],
                          cached_reply: null,
                          handoff_template: JSON.parse(params[11]),
                          actions: [],
                          suggestions: [],
                          status: 'CANDIDATE',
                          positive_count: 1,
                          negative_count: 0,
                          distinct_positive_users: 1,
                          positive_user_hashes: JSON.parse(params[12]),
                          hit_count: 0,
                          llm_tokens_saved: 0,
                          trust_score: params[13],
                          platform_doc_version: null,
                          last_hit_at: null,
                          updated_at: new Date(),
                      }
                    : {
                          id: randomUUID(),
                          scope_level: 'GLOBAL_SAFE',
                          owner_scope: params[0],
                          user_id: null,
                          account_id: null,
                          locale: params[1],
                          domain_category: params[2],
                          sub_intent: null,
                          intent_key: params[3],
                          canonical_question: params[4],
                          normalized_question: params[5],
                          content_hash: params[6],
                          variant_phrases: JSON.parse(params[7]),
                          embedding_model: params[8],
                          dimensions: params[9],
                          embedding_f64: params[10],
                          cached_reply: params[11],
                          handoff_template: null,
                          actions: JSON.parse(params[12]),
                          suggestions: JSON.parse(params[13]),
                          status: 'CANDIDATE',
                          positive_count: 1,
                          negative_count: 0,
                          distinct_positive_users: 1,
                          positive_user_hashes: JSON.parse(params[14]),
                          hit_count: 0,
                          llm_tokens_saved: 0,
                          trust_score: params[15],
                          platform_doc_version: params[16],
                          last_hit_at: null,
                          updated_at: new Date(),
                      };

                store.memories.push(newRow);
                return [newRow];
            }

            if (/UPDATE ai_semantic_memory SET variant_phrases/i.test(sql)) {
                const rec = store.memories.find((m) => m.id === params[6] || m.id === params[7]);
                if (rec) {
                    const hasDocVer = params.length === 8;
                    rec.variant_phrases = JSON.parse(params[0]);
                    rec.positive_count = params[1];
                    rec.distinct_positive_users = params[2];
                    rec.positive_user_hashes = JSON.parse(params[3]);
                    rec.trust_score = params[4];
                    rec.status = params[5];
                    if (hasDocVer && params[6]) {
                        rec.platform_doc_version = params[6];
                    }
                    rec.updated_at = new Date();
                }
                return [];
            }

            if (/UPDATE ai_semantic_memory SET positive_count = \$1/i.test(sql)) {
                const rec = store.memories.find((m) => m.id === params[4]);
                if (rec) {
                    rec.positive_count = params[0];
                    rec.distinct_positive_users = params[1];
                    rec.positive_user_hashes = JSON.parse(params[2]);
                    rec.trust_score = params[3];
                }
                return [];
            }

            if (/UPDATE ai_semantic_memory SET negative_count = \$1/i.test(sql)) {
                const rec = store.memories.find((m) => m.id === params[3]);
                if (rec) {
                    rec.negative_count = params[0];
                    rec.trust_score = params[1];
                    rec.status = params[2];
                }
                return [];
            }

            if (/UPDATE ai_semantic_memory SET hit_count = hit_count \+ 1/i.test(sql)) {
                const rec = store.memories.find((m) => m.id === params[1]);
                if (rec) {
                    rec.hit_count += 1;
                    rec.llm_tokens_saved += params[0];
                }
                return [];
            }

            if (/FROM ai_chat_messages m/i.test(sql)) {
                return store.messages;
            }

            if (/FROM ai_message_feedback f LEFT JOIN/i.test(sql)) {
                return store.feedbacks;
            }

            if (/FROM ai_message_feedback WHERE rating = 1/i.test(sql)) {
                return store.feedbacks.filter((f) => f.rating === 1);
            }

            if (/FROM ai_message_feedback WHERE rating = -1/i.test(sql)) {
                return store.feedbacks.filter((f) => f.rating === -1);
            }

            if (/GROUP BY scope_level, status/i.test(sql)) {
                const grouped = new Map<string, any>();
                for (const m of store.memories) {
                    const key = `${m.scope_level}::${m.status}`;
                    const g = grouped.get(key) || {
                        scope_level: m.scope_level,
                        status: m.status,
                        cnt: 0,
                        hits: 0,
                        tokens_saved: 0,
                    };
                    g.cnt += 1;
                    g.hits += m.hit_count || 0;
                    g.tokens_saved += m.llm_tokens_saved || 0;
                    grouped.set(key, g);
                }
                return Array.from(grouped.values());
            }

            if (/FROM ai_semantic_memory WHERE owner_scope = \$1 ORDER BY hit_count/i.test(sql)) {
                return store.memories.filter((m) => m.owner_scope === params[0]);
            }

            if (/FROM ai_semantic_memory WHERE scope_level = 'GLOBAL_SAFE'/i.test(sql)) {
                return store.memories.filter(
                    (m) =>
                        m.scope_level === 'GLOBAL_SAFE' &&
                        m.owner_scope === GLOBAL_MEMORY_OWNER_SCOPE &&
                        m.status === 'ACTIVE' &&
                        m.cached_reply
                );
            }

            if (/FILTER \(WHERE owner_scope = \$1/i.test(sql)) {
                return [
                    {
                        global_with_user_id: store.memories.filter(
                            (m) => m.owner_scope === GLOBAL_MEMORY_OWNER_SCOPE && m.user_id !== null
                        ).length,
                        pattern_with_reply: store.memories.filter(
                            (m) => m.scope_level === 'GLOBAL_INTENT_PATTERN' && m.cached_reply !== null
                        ).length,
                        quarantined_count: store.memories.filter(
                            (m) => m.status === 'QUARANTINED'
                        ).length,
                    },
                ];
            }

            return [];
        }),
    } as any;
}

describe('Phase 6 — Per-Response Feedback, Self-Growing Hybrid Memory, DLP Security & Training Report', () => {
    it('1. Enforces multi-tenant isolation: PERSONAL_ANALYTICS never stores cached_reply globally; User B gets GLOBAL_INTENT_PATTERN only with 0 Qwen calls', async () => {
        const store: InMemoryStore = { memories: [], synonyms: [], feedbacks: [], messages: [] };
        const dataSource = createMockLearningDataSource(store);
        const kb = new AiKnowledgeBaseService();
        const sanitizer = new AiPrivacySanitizerService();
        const promptSystem = new AiPromptSystemService();
        const semanticMemory = new AiSemanticMemoryService(dataSource, kb, sanitizer);
        await semanticMemory.ensureInitialized();

        const autoLearning = new AiAutoLearningService(sanitizer, semanticMemory, promptSystem);

        const sensitiveReply =
            'Olá Derci, na sua conta MT5 8844123 o lucro em XAUUSD foi $2,350.00 com winrate de 64%.';

        // DLP inspect must explicitly block PERSONAL_ANALYTICS + financial data + SQL tools
        const dlpCheck = sanitizer.inspectCandidateForGlobalSafe({
            question: 'Qual e o meu edge em XAUUSD?',
            reply: sensitiveReply,
            domainCategory: 'PERSONAL_ANALYTICS',
            intent: 'edge_strengths',
            sqlToolsUsed: ['sql_symbol_and_setup_matrix'],
            ragSourcesUsed: ['TRADE_NOTE'],
            userNames: ['Derci'],
        });
        expect(dlpCheck.eligible).toBe(false);
        expect(dlpCheck.reasons).toEqual(
            expect.arrayContaining([
                'INVALID_DOMAIN:PERSONAL_ANALYTICS',
                'PRIVATE_SQL_TOOLS_USED',
                'PRIVATE_RAG_SOURCES:TRADE_NOTE',
                'DLP_FLAG:MONETARY_AMOUNT',
                'DLP_FLAG:USER_NAME',
            ])
        );

        // 3 distinct users vote 👍 on edge strength pattern -> creates GLOBAL_INTENT_PATTERN (cached_reply ALWAYS null)
        for (const uid of ['user-A', 'user-B', 'user-C']) {
            const res = await autoLearning.processFeedback({
                userId: uid,
                userName: 'Derci',
                sessionId: randomUUID(),
                messageId: randomUUID(),
                rating: 1,
                locale: 'pt',
                question: 'Qual e o meu edge em XAUUSD?',
                normalizedQuestion: 'qual e o meu edge em xauusd',
                reply: sensitiveReply,
                intent: 'edge_strengths',
                metadata: {
                    domainCategory: 'PERSONAL_ANALYTICS',
                    routerDecision: 'ESCALATE_TO_GEMINI',
                    sqlToolsUsed: ['sql_symbol_and_setup_matrix'],
                },
            });
            expect(res.action).toBe('GLOBAL_INTENT_PATTERN_UPSERTED');
        }

        expect(store.memories).toHaveLength(1);
        const patternRow = store.memories[0];
        expect(patternRow.scope_level).toBe('GLOBAL_INTENT_PATTERN');
        expect(patternRow.owner_scope).toBe(GLOBAL_MEMORY_OWNER_SCOPE);
        expect(patternRow.user_id).toBeNull();
        expect(patternRow.cached_reply).toBeNull();
        expect(patternRow.status).toBe('ACTIVE');
        expect(patternRow.canonical_question).not.toContain('$2,350');
        expect(patternRow.canonical_question).not.toContain('XAUUSD');

        // Another user asks a similar question with GBPUSD -> skips Qwen Router (0 Qwen calls) and builds handoff strictly for User D's symbol
        const generateRouterJson = jest.fn();
        const mockLlmProvider = {
            getDualEngineStatus: () => ({ anyEnabled: true, qwenEnabled: true, geminiEnabled: true }),
            generateRouterJson,
        } as any;

        const routerService = new AiRouterService(
            mockLlmProvider,
            kb,
            promptSystem,
            undefined,
            undefined,
            semanticMemory
        );

        const inspection = promptSystem.inspectAndClassifyInput(
            'Qual e o meu edge em GBPUSD?',
            500,
            'pt'
        );
        const decision = await routerService.routeUserMessage({
            userName: 'Maria',
            trimmedQuestion: 'Qual e o meu edge em GBPUSD?',
            inspection,
            previousMessages: [],
            accountHint: {
                accountLabel: 'Conta Maria',
                hasData: true,
                totalTrades: 45,
                openPositionsCount: 0,
                topSymbols: ['GBPUSD'],
                hasDailyNotes: false,
                hasPlaybookRules: false,
            },
            locale: 'pt',
            userId: 'user-D',
            accountId: 'acc-maria',
        });

        expect(generateRouterJson).not.toHaveBeenCalled();
        expect(decision.decision).toBe('ESCALATE_TO_GEMINI');
        expect(decision.routerProvider).toBe('semantic_memory_pattern');
        expect(decision.memoryHitScope).toBe('GLOBAL_INTENT_PATTERN');
        expect(decision.reply).toBeUndefined();
        expect(decision.handoff?.targetSymbols).toContain('GBPUSD');
        expect(decision.routerTokensUsed).toBe(0);
    });

    it('2. Blocks PII (email, phone, broker login, secret token) in DLP sanitizer & GLOBAL_SAFE gate', () => {
        const sanitizer = new AiPrivacySanitizerService();

        const dirty =
            'Contato trader@email.com tel +258 84 998 1122 MT5 login: 99112233 token sk-proj-superSecretKeyValue123456 saldo $1,250.50 em 2026-10-12.';
        const cleaned = sanitizer.sanitizeTextForTraining(dirty, { userNames: ['Carlos'] });

        expect(cleaned.cleanText).not.toContain('trader@email.com');
        expect(cleaned.cleanText).not.toContain('99112233');
        expect(cleaned.cleanText).not.toContain('superSecretKeyValue');
        expect(cleaned.cleanText).not.toContain('$1,250.50');
        expect(cleaned.cleanText).not.toContain('2026-10-12');
        expect(cleaned.cleanText).toContain('<EMAIL>');
        expect(cleaned.cleanText).toContain('<ACCOUNT_ID>');
        expect(cleaned.cleanText).toContain('<SECRET>');
        expect(cleaned.cleanText).toContain('<AMOUNT>');
        expect(cleaned.flags.length).toBeGreaterThanOrEqual(5);

        const globalGate = sanitizer.inspectCandidateForGlobalSafe({
            question: 'Como importar trades MT5?',
            reply: 'Envie email para suporte@meudominio.com com login 1234567.',
            domainCategory: 'PLATFORM_KNOWLEDGE',
            intent: 'guide:import_trades',
        });
        expect(globalGate.eligible).toBe(false);
        expect(globalGate.reasons).toEqual(expect.arrayContaining(['DLP_FLAG:EMAIL']));
    });

    it('3. Enforces anti-poisoning quorum (same user x4 stays CANDIDATE; 3 distinct users -> ACTIVE)', async () => {
        const store: InMemoryStore = { memories: [], synonyms: [], feedbacks: [], messages: [] };
        const dataSource = createMockLearningDataSource(store);
        const kb = new AiKnowledgeBaseService();
        const sanitizer = new AiPrivacySanitizerService();
        const promptSystem = new AiPromptSystemService();
        const semanticMemory = new AiSemanticMemoryService(dataSource, kb, sanitizer);
        await semanticMemory.ensureInitialized();
        const autoLearning = new AiAutoLearningService(sanitizer, semanticMemory, promptSystem);

        const officialGuideReply =
            'Para trazer as suas operações, aceda a `/add-trades` e conecte via MT5, Deriv ou ficheiro CSV (+20 corretoras).';

        for (let i = 0; i < 4; i += 1) {
            const r = await autoLearning.processFeedback({
                userId: 'user-poison-attacker',
                sessionId: randomUUID(),
                messageId: randomUUID(),
                rating: 1,
                locale: 'pt',
                question: 'Como importar trades via MT5 ou CSV?',
                normalizedQuestion: 'como importar trades via mt5 ou csv',
                reply: officialGuideReply,
                intent: 'guide:import_trades',
                metadata: { domainCategory: 'PLATFORM_KNOWLEDGE' },
            });
            expect(r.action).toBe('GLOBAL_SAFE_UPSERTED');
            expect(r.status).toBe('CANDIDATE');
        }

        expect(store.memories).toHaveLength(1);
        expect(store.memories[0].distinct_positive_users).toBe(1);
        expect(store.memories[0].status).toBe('CANDIDATE');

        // 2 more distinct users approve -> reaches quorum = 3 -> ACTIVE!
        await autoLearning.processFeedback({
            userId: 'user-legit-2',
            sessionId: randomUUID(),
            messageId: randomUUID(),
            rating: 1,
            locale: 'pt',
            question: 'Como importar operacoes do MT5?',
            normalizedQuestion: 'como importar operacoes do mt5',
            reply: officialGuideReply,
            intent: 'guide:import_trades',
            metadata: { domainCategory: 'PLATFORM_KNOWLEDGE' },
        });
        expect(store.memories[0].status).toBe('CANDIDATE');

        const promoted = await autoLearning.processFeedback({
            userId: 'user-legit-3',
            sessionId: randomUUID(),
            messageId: randomUUID(),
            rating: 1,
            locale: 'pt',
            question: 'Como sincronizar trades MT5?',
            normalizedQuestion: 'como sincronizar trades mt5',
            reply: officialGuideReply,
            intent: 'guide:import_trades',
            metadata: { domainCategory: 'PLATFORM_KNOWLEDGE' },
        });

        expect(promoted.status).toBe('ACTIVE');
        expect(store.memories[0].distinct_positive_users).toBe(3);
        expect(store.memories[0].trust_score).toBeGreaterThanOrEqual(0.8);
    });

    it('4. Closest-words & typo expansion ("metrader", "puxar operacoes") hits ACTIVE memory with 0 LLM calls', async () => {
        const store: InMemoryStore = {
            memories: [
                {
                    id: '11111111-1111-4111-8111-111111111111',
                    scope_level: 'GLOBAL_SAFE',
                    owner_scope: GLOBAL_MEMORY_OWNER_SCOPE,
                    user_id: null,
                    account_id: null,
                    locale: 'pt',
                    domain_category: 'PLATFORM_KNOWLEDGE',
                    sub_intent: null,
                    intent_key: 'guide:import_trades',
                    canonical_question: 'Como importar trades MT5 sincronizar?',
                    normalized_question: 'como importar trades mt5 sincronizar',
                    content_hash: 'hash-mt5-import',
                    variant_phrases: [
                        'sincronizar mt5 importar operacoes',
                        'como puxar operacoes do mt5',
                        'como importar operacoes do mt5',
                    ],
                    embedding_model: 'gemini-embedding-2',
                    dimensions: 768,
                    embedding_f64: [],
                    cached_reply:
                        'Aceda a `/add-trades`, escolha MT5 Cloud Sync ou upload CSV/HTML para importar os seus trades automaticamente.',
                    handoff_template: null,
                    actions: [{ label: 'Importar Trades', route: '/add-trades' }],
                    suggestions: ['Como fazer backtesting?'],
                    status: 'ACTIVE',
                    positive_count: 5,
                    negative_count: 0,
                    distinct_positive_users: 4,
                    positive_user_hashes: ['h1', 'h2', 'h3', 'h4'],
                    hit_count: 2,
                    llm_tokens_saved: 900,
                    trust_score: 0.96,
                    platform_doc_version: null,
                },
            ],
            synonyms: [],
            feedbacks: [],
            messages: [],
        };

        const dataSource = createMockLearningDataSource(store);
        const kb = new AiKnowledgeBaseService();
        const sanitizer = new AiPrivacySanitizerService();
        const promptSystem = new AiPromptSystemService();
        const semanticMemory = new AiSemanticMemoryService(dataSource, kb, sanitizer);
        await semanticMemory.ensureInitialized();

        const generateRouterJson = jest.fn();
        const mockLlmProvider = {
            getDualEngineStatus: () => ({ anyEnabled: true, qwenEnabled: true, geminiEnabled: true }),
            generateRouterJson,
        } as any;

        const routerService = new AiRouterService(
            mockLlmProvider,
            kb,
            promptSystem,
            undefined,
            undefined,
            semanticMemory
        );

        const typoQuestion = 'como puxar operacoes do metrader?';
        const inspection = promptSystem.inspectAndClassifyInput(typoQuestion, 500, 'pt');

        const decision = await routerService.routeUserMessage({
            userName: 'Ana',
            trimmedQuestion: typoQuestion,
            inspection,
            previousMessages: [],
            accountHint: {
                accountLabel: 'Conta Ana',
                hasData: false,
                totalTrades: 0,
                openPositionsCount: 0,
                topSymbols: [],
                hasDailyNotes: false,
                hasPlaybookRules: false,
            },
            locale: 'pt',
            userId: 'user-ana',
        });

        expect(generateRouterJson).not.toHaveBeenCalled();
        expect(decision.decision).toBe('DIRECT_REPLY');
        expect(decision.routerProvider).toBe('semantic_memory_global');
        expect(decision.routerModel).toBe('hybrid_vector_lexical_zero_llm');
        expect(decision.memoryHitScope).toBe('GLOBAL_SAFE');
        expect(decision.routerTokensUsed).toBe(0);
        expect(decision.reply).toContain('/add-trades');
        expect(decision.lexicalExpansions).toEqual(
            expect.arrayContaining([expect.stringContaining('metrader->')])
        );
    });

    it('5. Auto-quarantines memory on 👎 feedback & enforces strict ownership (IDOR check)', async () => {
        const memId = '22222222-2222-4222-8222-222222222222';
        const store: InMemoryStore = {
            memories: [
                {
                    id: memId,
                    scope_level: 'GLOBAL_SAFE',
                    owner_scope: GLOBAL_MEMORY_OWNER_SCOPE,
                    user_id: null,
                    account_id: null,
                    locale: 'pt',
                    domain_category: 'PLATFORM_KNOWLEDGE',
                    sub_intent: null,
                    intent_key: 'guide:backtesting_replay',
                    canonical_question: 'Como fazer backtesting?',
                    normalized_question: 'como fazer backtesting',
                    content_hash: 'hash-bt',
                    variant_phrases: [],
                    embedding_model: 'gemini-embedding-2',
                    dimensions: 768,
                    embedding_f64: [],
                    cached_reply: 'Resposta desatualizada sobre replay.',
                    handoff_template: null,
                    actions: [],
                    suggestions: [],
                    status: 'ACTIVE',
                    positive_count: 1,
                    negative_count: 1,
                    distinct_positive_users: 1,
                    positive_user_hashes: ['u1'],
                    hit_count: 1,
                    llm_tokens_saved: 300,
                    trust_score: 0.5,
                    platform_doc_version: null,
                },
            ],
            synonyms: [],
            feedbacks: [],
            messages: [],
        };

        const dataSource = createMockLearningDataSource(store);
        const kb = new AiKnowledgeBaseService();
        const sanitizer = new AiPrivacySanitizerService();
        const promptSystem = new AiPromptSystemService();
        const semanticMemory = new AiSemanticMemoryService(dataSource, kb, sanitizer);
        await semanticMemory.ensureInitialized();
        const autoLearning = new AiAutoLearningService(sanitizer, semanticMemory, promptSystem);

        // Second 👎 pushes neg >= 2 and trustScore < 0.45 -> QUARANTINED
        await autoLearning.processFeedback({
            userId: 'user-critic',
            sessionId: randomUUID(),
            messageId: randomUUID(),
            rating: -1,
            reasonCode: 'INACCURATE',
            locale: 'pt',
            question: 'Como fazer backtesting?',
            normalizedQuestion: 'como fazer backtesting',
            reply: 'Resposta desatualizada sobre replay.',
            metadata: { semanticMemoryId: memId },
        });

        expect(store.memories[0].status).toBe('QUARANTINED');
        expect(store.memories[0].trust_score).toBeLessThan(0.45);

        const afterLookup = await semanticMemory.lookupMemory({
            userId: 'user-other',
            trimmedQuestion: 'Como fazer backtesting?',
            normalizedLookup: 'como fazer backtesting',
            locale: 'pt',
        });
        expect(afterLookup.hitType).toBe('NONE');

        // IDOR check on TorexAiChatService.submitMessageFeedback
        const validMsgUuid = '33333333-3333-4333-8333-333333333333';
        const sessionRepo = {
            findOne: jest.fn(async ({ where }: any) => {
                if (where.userId === 'user-owner') {
                    return { id: where.id, userId: 'user-owner' };
                }
                return null;
            }),
        } as any;
        const messageRepo = {
            findOne: jest.fn(async () => ({
                id: validMsgUuid,
                sessionId: '44444444-4444-4444-8444-444444444444',
                role: 'assistant',
                intent: 'guide:backtesting_replay',
                content: 'Guia...',
                createdAt: new Date(),
                metadata: {},
            })),
            find: jest.fn(async () => []),
            save: jest.fn(async (m: any) => m),
        } as any;

        const chatService = new TorexAiChatService(
            dataSource,
            sessionRepo,
            messageRepo,
            {} as any,
            kb,
            {} as any,
            {} as any,
            {} as any,
            promptSystem,
            {} as any,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            semanticMemory,
            sanitizer
        );

        await expect(
            chatService.submitMessageFeedback({
                userId: 'user-attacker',
                messageId: validMsgUuid,
                rating: -1,
            })
        ).rejects.toThrow(NotFoundException);

        await expect(
            chatService.submitMessageFeedback({
                userId: 'user-owner',
                messageId: 'not-a-uuid',
                rating: 1,
            })
        ).rejects.toThrow(BadRequestException);
    });

    it('6. AiTrainingReportService exports Markdown & JSONL datasets with 0 leaked emails, secrets, balances, or userIds', async () => {
        const store: InMemoryStore = {
            memories: [
                {
                    id: '55555555-5555-4555-8555-555555555555',
                    scope_level: 'GLOBAL_SAFE',
                    owner_scope: GLOBAL_MEMORY_OWNER_SCOPE,
                    user_id: null,
                    locale: 'pt',
                    domain_category: 'PLATFORM_KNOWLEDGE',
                    canonical_question: 'Como importar trades MT5?',
                    variant_phrases: [],
                    cached_reply: 'Aceda a `/add-trades` para conectar MT5.',
                    hit_count: 10,
                    distinct_positive_users: 4,
                    trust_score: 0.94,
                    llm_tokens_saved: 4500,
                    status: 'ACTIVE',
                },
            ],
            synonyms: [
                {
                    surface_term: 'metrader',
                    canonical_term: 'mt5 sincronizar',
                    locale: 'pt',
                    intent_key: 'guide:import_trades',
                    co_occurrence_count: 6,
                    positive_weight: 2.0,
                },
            ],
            feedbacks: [
                {
                    id: '66666666-6666-4666-8666-666666666666',
                    rating: 1,
                    reason_code: 'HELPFUL',
                    correction_note: null,
                    locale: 'pt',
                    domain_category: 'PLATFORM_KNOWLEDGE',
                    intent: 'guide:import_trades',
                    router_decision: 'DIRECT_REPLY',
                    router_model: 'hybrid_vector_lexical_zero_llm',
                    analyst_model: null,
                    normalized_question: 'como importar da conta 99112233 email secret@trader.io',
                    assistant_reply: 'Vá até `/add-trades`.',
                },
                {
                    id: '77777777-7777-4777-8777-777777777777',
                    rating: -1,
                    reason_code: 'INACCURATE',
                    correction_note: 'Meu saldo era $9,999.00 na conta MT5 884455',
                    locale: 'pt',
                    domain_category: 'PERSONAL_ANALYTICS',
                    intent: 'status_overview',
                    router_decision: 'ESCALATE_TO_GEMINI',
                    router_model: 'qwen-plus',
                    analyst_model: 'gemini-2.5-pro',
                    normalized_question: 'quanto lucrei $9,999.00',
                    assistant_reply: 'Seu lucro foi $1,000.00.',
                },
            ],
            messages: [
                {
                    id: '88888888-8888-4888-8888-888888888888',
                    intent: 'guide:import_trades',
                    provider: 'semantic_memory_global',
                    metadata: {
                        routerDecision: 'DIRECT_REPLY',
                        memoryHitScope: 'GLOBAL_SAFE',
                        semanticConfidence: 'HIGH',
                        tokensUsed: 0,
                        routerLatencyMs: 12,
                    },
                    user_question: 'como importar mt5?',
                },
            ],
        };

        const dataSource = createMockLearningDataSource(store);
        const kb = new AiKnowledgeBaseService();
        const sanitizer = new AiPrivacySanitizerService();
        const semanticMemory = new AiSemanticMemoryService(dataSource, kb, sanitizer);
        await semanticMemory.ensureInitialized();

        const reportService = new AiTrainingReportService(
            dataSource,
            sanitizer,
            semanticMemory,
            kb
        );

        const report = await reportService.generateTrainingReport({ days: 30 });
        expect(report.securityAudit.dlpGuaranteeStatus).toBe('PASS');
        expect(report.feedbackSummary.thumbsUp).toBe(1);
        expect(report.feedbackSummary.thumbsDown).toBe(1);
        expect(report.securityAudit.piiRedactionsInReport).toBeGreaterThanOrEqual(1);

        const md = reportService.renderMarkdownReport(report);
        expect(md).toContain('Relatório Completo de Dados & Treinamento');
        expect(md).not.toContain('$9,999.00');
        expect(md).not.toContain('secret@trader.io');

        for (const fmt of ['sft_jsonl', 'rag_qa_jsonl', 'dpo_jsonl', 'eval_jsonl'] as const) {
            const artifact = await reportService.exportArtifact(fmt, { days: 30 });
            expect(artifact.recordCount).toBeGreaterThanOrEqual(1);
            expect(artifact.content).not.toContain('secret@trader.io');
            expect(artifact.content).not.toContain('$9,999.00');
            expect(artifact.content).not.toContain('$1,000.00');
            expect(artifact.content).not.toContain('99112233');
            expect(artifact.content).not.toContain('884455');

            // Ensure every line is valid JSON
            const lines = artifact.content.split('\n').filter(Boolean);
            for (const line of lines) {
                expect(() => JSON.parse(line)).not.toThrow();
            }
        }
    });
});
