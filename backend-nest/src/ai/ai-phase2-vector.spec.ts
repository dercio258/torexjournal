import { of, throwError } from 'rxjs';
import { AiEmbeddingService } from './ai-embedding.service';
import { AiVectorStoreService } from './ai-vector-store.service';
import {
    AI_EMBEDDING_DIMENSIONS,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    FALLBACK_GEMINI_EMBEDDING_MODEL,
} from './ai-vector-schema';

const makeUniformVector = (val: number, dims = AI_EMBEDDING_DIMENSIONS): number[] =>
    new Array(dims).fill(val);

const makeUnitVectorAt = (index: number, dims = AI_EMBEDDING_DIMENSIONS): number[] => {
    const vec = new Array(dims).fill(0);
    vec[index] = 1;
    return vec;
};

describe('Phase 2: PostgreSQL Vector Storage (pgvector + double precision[]) & Gemini Embedding 2', () => {
    describe('AiEmbeddingService', () => {
        it('rejects text-embedding-004, enforces gemini-embedding-2 (768d) and sends x-goog-api-key header', async () => {
            const rawVec = new Array(AI_EMBEDDING_DIMENSIONS).fill(3);
            const httpPost = jest.fn().mockReturnValue(
                of({
                    data: {
                        embedding: { values: rawVec },
                    },
                })
            );

            const configValues: Record<string, string> = {
                GEMINI_API_KEY: 'AIza-test-secret',
                GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
            };
            const service = new AiEmbeddingService(
                { get: jest.fn((k: string) => configValues[k]) } as any,
                { post: httpPost } as any,
                { get: jest.fn().mockResolvedValue(null), set: jest.fn() } as any
            );

            expect(service.getStatus()).toMatchObject({
                enabled: true,
                provider: 'gemini',
                model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                dimensions: AI_EMBEDDING_DIMENSIONS,
            });

            const res = await service.embedText('Qual foi meu win rate em XAUUSD?', {
                taskType: 'RETRIEVAL_QUERY',
            });

            expect(httpPost).toHaveBeenCalledTimes(1);
            const [url, body, opts] = httpPost.mock.calls[0];
            expect(url).toBe(
                `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_EMBEDDING_MODEL}:embedContent`
            );
            expect(url).not.toContain('text-embedding-004');
            expect(url).not.toContain('AIza-test-secret');
            expect(opts.headers['x-goog-api-key']).toBe('AIza-test-secret');
            expect(body).toMatchObject({
                model: `models/${DEFAULT_GEMINI_EMBEDDING_MODEL}`,
                taskType: 'RETRIEVAL_QUERY',
                outputDimensionality: AI_EMBEDDING_DIMENSIONS,
            });

            expect(res).not.toBeNull();
            expect(res!.dimensions).toBe(AI_EMBEDDING_DIMENSIONS);
            const norm = Math.sqrt(res!.values.reduce((acc, v) => acc + v * v, 0));
            expect(norm).toBeCloseTo(1, 5);
        });

        it('falls back to gemini-embedding-2-preview when gemini-embedding-2 returns HTTP 404', async () => {
            const unitVec = makeUnitVectorAt(0);
            const httpPost = jest
                .fn()
                .mockImplementationOnce(() =>
                    throwError(() => ({ response: { status: 404 } }))
                )
                .mockImplementationOnce(() =>
                    of({
                        data: {
                            embedding: { values: unitVec },
                        },
                    })
                );

            const service = new AiEmbeddingService(
                {
                    get: jest.fn((k: string) =>
                        k === 'GEMINI_API_KEY' ? 'AIza-test-secret' : undefined
                    ),
                } as any,
                { post: httpPost } as any
            );

            const res = await service.embedText('O que é Profit Factor?', {
                taskType: 'CLASSIFICATION',
            });

            expect(httpPost).toHaveBeenCalledTimes(2);
            expect(httpPost.mock.calls[0][0]).toContain(
                `${DEFAULT_GEMINI_EMBEDDING_MODEL}:embedContent`
            );
            expect(httpPost.mock.calls[1][0]).toContain(
                `${FALLBACK_GEMINI_EMBEDDING_MODEL}:embedContent`
            );
            expect(res?.model).toBe(FALLBACK_GEMINI_EMBEDDING_MODEL);
        });

        it('computes L2 normalization and cosine similarity accurately', () => {
            const service = new AiEmbeddingService(
                { get: jest.fn() } as any,
                { post: jest.fn() } as any
            );

            const normalized = service.l2Normalize([3, 4]);
            expect(normalized[0]).toBeCloseTo(0.6, 6);
            expect(normalized[1]).toBeCloseTo(0.8, 6);

            expect(service.cosineSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1, 6);
            expect(service.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
            expect(service.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
            expect(service.l2Normalize([0, 0, 0])).toEqual([]);
        });

        it('uses cache and deduplicates batch texts in embedBatch via batchEmbedContents', async () => {
            const serviceForHash = new AiEmbeddingService(
                { get: jest.fn() } as any,
                { post: jest.fn() } as any
            );
            const cachedHash = serviceForHash.computeContentHash(
                'Texto em cache',
                'RETRIEVAL_DOCUMENT'
            );

            const cacheStore = new Map<string, any>([
                [
                    `ai:emb:v2:${cachedHash}`,
                    {
                        values: makeUnitVectorAt(1),
                        model: DEFAULT_GEMINI_EMBEDDING_MODEL,
                        dimensions: AI_EMBEDDING_DIMENSIONS,
                        contentHash: cachedHash,
                        cached: true,
                    },
                ],
            ]);

            const httpPost = jest.fn().mockReturnValue(
                of({
                    data: {
                        embeddings: [{ values: makeUniformVector(2) }],
                    },
                })
            );

            const service = new AiEmbeddingService(
                {
                    get: jest.fn((k: string) =>
                        k === 'GEMINI_API_KEY' ? 'AIza-batch-key' : undefined
                    ),
                } as any,
                { post: httpPost } as any,
                {
                    get: jest.fn(async (k: string) => cacheStore.get(k) || null),
                    set: jest.fn(async (k: string, v: any) => {
                        cacheStore.set(k, v);
                    }),
                } as any
            );

            const results = await service.embedBatch([
                { text: 'Texto em cache', taskType: 'RETRIEVAL_DOCUMENT' },
                { text: 'Nota do diário nova', taskType: 'RETRIEVAL_DOCUMENT', title: 'Diário' },
                { text: 'Nota do diário nova', taskType: 'RETRIEVAL_DOCUMENT', title: 'Diário' },
            ]);

            expect(httpPost).toHaveBeenCalledTimes(1);
            const [url, body] = httpPost.mock.calls[0];
            expect(url).toContain(`${DEFAULT_GEMINI_EMBEDDING_MODEL}:batchEmbedContents`);
            // Cached item excluded and 2 identical items collapsed to 1 request
            expect(body.requests).toHaveLength(1);
            expect(results[0]?.cached).toBe(true);
            expect(results[1]?.cached).toBe(false);
            expect(results[2]?.values).toEqual(results[1]?.values);
        });
    });

    describe('AiVectorStoreService', () => {
        it('initializes in double precision[] mode when pgvector is unavailable and queries ai_cosine_similarity_f64', async () => {
            const executedSql: string[] = [];
            const queryMock = jest.fn(async (sql: string) => {
                executedSql.push(sql);
                if (sql.includes('pg_available_extensions')) {
                    return [{ pgvector_available: false, pgvector_installed: false }];
                }
                if (sql.includes('FROM "ai_intent_anchors"')) {
                    return [
                        {
                            id: 'anchor-1',
                            anchor_key: 'pa_winrate',
                            domain_category: 'PERSONAL_ANALYTICS',
                            sub_intent: 'STATUS_OVERVIEW',
                            locale: 'pt',
                            phrase: 'Qual meu win rate recente?',
                            metadata: { source: 'seed' },
                            similarity: 0.91,
                        },
                    ];
                }
                return [];
            });

            const store = new AiVectorStoreService({
                isInitialized: true,
                query: queryMock,
            } as any);

            const status = await store.ensureInitialized();
            expect(status).toEqual({
                initialized: true,
                backend: 'float8_array',
                dimensions: AI_EMBEDDING_DIMENSIONS,
            });
            expect(executedSql.some((s) => s.includes('ai_cosine_similarity_f64'))).toBe(
                true
            );
            expect(executedSql.some((s) => s.includes('vector(768)'))).toBe(false);

            const matches = await store.searchIntentAnchors({
                queryVector: makeUnitVectorAt(0),
                locale: 'pt',
                topK: 3,
                minSimilarity: 0.5,
            });

            expect(matches).toHaveLength(1);
            expect(matches[0].domainCategory).toBe('PERSONAL_ANALYTICS');
            expect(matches[0].similarity).toBeCloseTo(0.91, 5);
            const searchSql = executedSql[executedSql.length - 1];
            expect(searchSql).toContain('ai_cosine_similarity_f64("embedding_f64", $1::float8[])');
        });

        it('upgrades to pgvector (vector(768) + HNSW) and uses cosine <=> operator when extension is installed', async () => {
            const executedSql: string[] = [];
            const queryMock = jest.fn(async (sql: string) => {
                executedSql.push(sql);
                if (sql.includes('pg_available_extensions')) {
                    return [{ pgvector_available: true, pgvector_installed: true }];
                }
                if (sql.includes('FROM "ai_rag_chunks"')) {
                    return [
                        {
                            id: 'chunk-1',
                            source_type: 'DAILY_NOTE',
                            source_id: 'note-123',
                            chunk_index: 0,
                            account_id: 'acc-1',
                            title: 'Sessão NY',
                            content: 'Evitar entradas contra tendência no Ouro.',
                            metadata: {},
                            similarity: 0.88,
                        },
                    ];
                }
                return [];
            });

            const store = new AiVectorStoreService({
                isInitialized: true,
                query: queryMock,
            } as any);

            const status = await store.ensureInitialized();
            expect(status.backend).toBe('pgvector');
            expect(executedSql.some((s) => s.includes('vector(768)'))).toBe(true);
            expect(executedSql.some((s) => s.includes('USING hnsw'))).toBe(true);

            const chunks = await store.searchRagChunks({
                queryVector: makeUnitVectorAt(2),
                userId: 'user-1',
                accountId: 'acc-1',
                sourceTypes: ['PLATFORM_DOC', 'DAILY_NOTE'],
                topK: 4,
                minSimilarity: 0.6,
            });

            expect(chunks).toHaveLength(1);
            expect(chunks[0].sourceType).toBe('DAILY_NOTE');
            const ragSql = executedSql[executedSql.length - 1];
            expect(ragSql).toContain('1 - ("embedding_vector" <=> $1::vector)');
            expect(ragSql).toContain('"owner_scope" = \'__GLOBAL__\'');
            expect(ragSql).toContain('"owner_scope" = $4 AND "user_id" = $4');
        });

        it('enforces allowed RAG source types and strict multi-tenant userId isolation (fail-closed)', async () => {
            const queryMock = jest.fn(async (sql: string) => {
                if (sql.includes('pg_available_extensions')) {
                    return [{ pgvector_available: false, pgvector_installed: false }];
                }
                return [];
            });

            const store = new AiVectorStoreService({
                isInitialized: true,
                query: queryMock,
            } as any);

            await expect(
                store.upsertRagChunks([
                    {
                        sourceType: 'BACKTESTING' as any,
                        userId: 'user-1',
                        sourceId: 'bt-1',
                        content: 'Sessão de backtest',
                        contentHash: 'hash',
                        embedding: makeUnitVectorAt(0),
                    },
                ])
            ).rejects.toThrow(/Disallowed RAG sourceType/i);

            await expect(
                store.upsertRagChunks([
                    {
                        sourceType: 'RAW_TRADES' as any,
                        userId: 'user-1',
                        sourceId: 'tr-1',
                        content: 'Histórico bruto',
                        contentHash: 'hash',
                        embedding: makeUnitVectorAt(0),
                    },
                ])
            ).rejects.toThrow(/Disallowed RAG sourceType/i);

            await expect(
                store.upsertRagChunks([
                    {
                        sourceType: 'DAILY_NOTE',
                        userId: null,
                        sourceId: 'dn-1',
                        content: 'Nota privada sem dono',
                        contentHash: 'hash',
                        embedding: makeUnitVectorAt(0),
                    },
                ])
            ).rejects.toThrow(/userId is required/i);

            await expect(
                store.searchRagChunks({
                    queryVector: makeUnitVectorAt(0),
                    userId: '',
                    sourceTypes: ['TRADE_NOTE'],
                })
            ).rejects.toThrow(/userId is required/i);
        });
    });
});
