import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiDomainCategory } from './ai-prompt-system.service';
import {
    AI_EMBEDDING_DIMENSIONS,
    ALLOWED_RAG_SOURCE_TYPES,
    AllowedRagSourceType,
    applyAiVectorSchema,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    GLOBAL_RAG_OWNER_SCOPE,
} from './ai-vector-schema';

export type VectorBackendKind = 'pgvector' | 'float8_array';

export interface VectorStoreStatus {
    initialized: boolean;
    backend: VectorBackendKind;
    dimensions: number;
}

export interface UpsertIntentAnchorInput {
    anchorKey: string;
    domainCategory: AiDomainCategory;
    subIntent?: string | null;
    locale?: string;
    phrase: string;
    contentHash: string;
    embedding: number[];
    embeddingModel?: string;
    metadata?: Record<string, any>;
    isActive?: boolean;
}

export interface IntentAnchorMatch {
    id: string;
    anchorKey: string;
    domainCategory: AiDomainCategory;
    subIntent: string | null;
    locale: string;
    phrase: string;
    similarity: number;
    metadata: Record<string, any>;
}

export interface UpsertRagChunkInput {
    sourceType: AllowedRagSourceType;
    userId?: string | null;
    accountId?: string | null;
    sourceId: string;
    chunkIndex?: number;
    title?: string | null;
    content: string;
    contentHash: string;
    embedding: number[];
    embeddingModel?: string;
    metadata?: Record<string, any>;
}

export interface RagChunkMatch {
    id: string;
    sourceType: AllowedRagSourceType;
    sourceId: string;
    chunkIndex: number;
    accountId: string | null;
    title: string | null;
    content: string;
    similarity: number;
    metadata: Record<string, any>;
}

const ALLOWED_DOMAINS: readonly AiDomainCategory[] = [
    'TRADING_CONCEPTS',
    'PLATFORM_KNOWLEDGE',
    'PERSONAL_ANALYTICS',
];

@Injectable()
export class AiVectorStoreService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AiVectorStoreService.name);
    private initialized = false;
    private backend: VectorBackendKind = 'float8_array';
    private initPromise: Promise<VectorStoreStatus> | null = null;

    constructor(
        @Optional()
        private readonly dataSource?: DataSource
    ) {}

    onApplicationBootstrap(): void {
        if (this.dataSource?.isInitialized) {
            void this.ensureInitialized().catch((err) =>
                this.logger.warn(
                    `Vector store bootstrap deferred: ${err?.message || err}`
                )
            );
        }
    }

    getStatus(): VectorStoreStatus {
        return {
            initialized: this.initialized,
            backend: this.backend,
            dimensions: AI_EMBEDDING_DIMENSIONS,
        };
    }

    async ensureInitialized(): Promise<VectorStoreStatus> {
        if (this.initialized) {
            return this.getStatus();
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        if (!this.dataSource?.isInitialized) {
            return this.getStatus();
        }

        this.initPromise = (async () => {
            try {
                const res = await applyAiVectorSchema(
                    this.dataSource!,
                    AI_EMBEDDING_DIMENSIONS
                );
                this.backend = res.pgvectorInstalled ? 'pgvector' : 'float8_array';
                this.initialized = true;
                if (this.backend === 'pgvector') {
                    this.logger.log(
                        `AI Vector Store initialized using PostgreSQL "pgvector" backend (${AI_EMBEDDING_DIMENSIONS}d, HNSW).`
                    );
                } else {
                    // Not fatal, but every RAG / intent search becomes a full table scan in SQL.
                    this.logger.warn(
                        `AI Vector Store running WITHOUT pgvector (float8_array fallback, ${AI_EMBEDDING_DIMENSIONS}d): ` +
                            `every similarity search scans the whole table. ` +
                            (res.pgvectorAvailable
                                ? `The "vector" extension is available but could not be created; run CREATE EXTENSION vector as a superuser.`
                                : `Install the pgvector extension on the PostgreSQL server to enable HNSW indexes.`)
                    );
                }
                return this.getStatus();
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    private requireDataSource(): DataSource {
        if (!this.dataSource?.isInitialized) {
            throw new Error('PostgreSQL DataSource is not initialized');
        }
        return this.dataSource;
    }

    private extractRows(res: any): any[] {
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.rows)) return res.rows;
        return [];
    }

    private validateVector(vec: number[], contextLabel: string): number[] {
        if (!Array.isArray(vec) || vec.length !== AI_EMBEDDING_DIMENSIONS) {
            throw new Error(
                `Invalid embedding dimensions for ${contextLabel}: expected ${AI_EMBEDDING_DIMENSIONS}, got ${Array.isArray(vec) ? vec.length : 0}`
            );
        }
        const validated = new Array<number>(vec.length);
        for (let i = 0; i < vec.length; i += 1) {
            const n = Number(vec[i]);
            if (!Number.isFinite(n)) {
                throw new Error(`Non-finite embedding coordinate at index ${i} (${contextLabel})`);
            }
            validated[i] = n;
        }
        return validated;
    }

    private toPgVectorLiteral(vec: number[]): string {
        return `[${vec.join(',')}]`;
    }

    private assertAllowedDomain(domain: string): AiDomainCategory {
        if (!ALLOWED_DOMAINS.includes(domain as AiDomainCategory)) {
            throw new Error(`Unsupported anchor domain category: "${domain}"`);
        }
        return domain as AiDomainCategory;
    }

    private assertAllowedRagSource(
        sourceType: string,
        userId?: string | null
    ): {
        sourceType: AllowedRagSourceType;
        ownerScope: string;
        resolvedUserId: string | null;
    } {
        if (!ALLOWED_RAG_SOURCE_TYPES.includes(sourceType as AllowedRagSourceType)) {
            throw new Error(
                `Disallowed RAG sourceType "${sourceType}". Allowed: ${ALLOWED_RAG_SOURCE_TYPES.join(', ')}`
            );
        }

        const typedSource = sourceType as AllowedRagSourceType;
        if (typedSource === 'PLATFORM_DOC') {
            return {
                sourceType: typedSource,
                ownerScope: GLOBAL_RAG_OWNER_SCOPE,
                resolvedUserId: null,
            };
        }

        const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!cleanUserId) {
            throw new Error(
                `userId is required for user-scoped RAG sourceType "${typedSource}"`
            );
        }

        return {
            sourceType: typedSource,
            ownerScope: cleanUserId,
            resolvedUserId: cleanUserId,
        };
    }

    async getExistingAnchorHashes(
        anchorKeys?: string[]
    ): Promise<Map<string, string>> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();

        const hasFilter = Array.isArray(anchorKeys) && anchorKeys.length > 0;
        const sql = hasFilter
            ? `SELECT "anchor_key", "content_hash" FROM "ai_intent_anchors" WHERE "anchor_key" = ANY($1::varchar[])`
            : `SELECT "anchor_key", "content_hash" FROM "ai_intent_anchors"`;
        const rows = this.extractRows(
            await ds.query(sql, hasFilter ? [anchorKeys] : [])
        );

        const result = new Map<string, string>();
        for (const r of rows) {
            if (r?.anchor_key && r?.content_hash) {
                result.set(String(r.anchor_key), String(r.content_hash));
            }
        }
        return result;
    }

    async upsertIntentAnchors(anchors: UpsertIntentAnchorInput[]): Promise<number> {
        if (!Array.isArray(anchors) || anchors.length === 0) return 0;
        await this.ensureInitialized();
        const ds = this.requireDataSource();

        let count = 0;
        for (const anchor of anchors) {
            const anchorKey = String(anchor.anchorKey || '').trim().slice(0, 120);
            if (!anchorKey) {
                throw new Error('anchorKey is required');
            }
            const domain = this.assertAllowedDomain(anchor.domainCategory);
            const vector = this.validateVector(anchor.embedding, `anchor:${anchorKey}`);
            const model =
                String(anchor.embeddingModel || DEFAULT_GEMINI_EMBEDDING_MODEL).slice(0, 80);
            const metadataJson = JSON.stringify(anchor.metadata || {});
            const subIntent = anchor.subIntent ? String(anchor.subIntent).slice(0, 60) : null;
            const locale = String(anchor.locale || 'pt').slice(0, 8);
            const isActive = anchor.isActive !== undefined ? Boolean(anchor.isActive) : true;

            if (this.backend === 'pgvector') {
                const vecLiteral = this.toPgVectorLiteral(vector);
                await ds.query(
                    `
                    INSERT INTO "ai_intent_anchors" (
                        "anchor_key", "domain_category", "sub_intent", "locale",
                        "phrase", "content_hash", "embedding_model", "dimensions",
                        "embedding_f64", "embedding_vector", "metadata", "is_active", "updated_at"
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9::float8[], $10::vector, $11::jsonb, $12, now()
                    )
                    ON CONFLICT ("anchor_key") DO UPDATE SET
                        "domain_category" = EXCLUDED."domain_category",
                        "sub_intent" = EXCLUDED."sub_intent",
                        "locale" = EXCLUDED."locale",
                        "phrase" = EXCLUDED."phrase",
                        "content_hash" = EXCLUDED."content_hash",
                        "embedding_model" = EXCLUDED."embedding_model",
                        "dimensions" = EXCLUDED."dimensions",
                        "embedding_f64" = EXCLUDED."embedding_f64",
                        "embedding_vector" = EXCLUDED."embedding_vector",
                        "metadata" = EXCLUDED."metadata",
                        "is_active" = EXCLUDED."is_active",
                        "updated_at" = now()
                    `,
                    [
                        anchorKey,
                        domain,
                        subIntent,
                        locale,
                        String(anchor.phrase || '').trim(),
                        String(anchor.contentHash || '').slice(0, 64),
                        model,
                        AI_EMBEDDING_DIMENSIONS,
                        vector,
                        vecLiteral,
                        metadataJson,
                        isActive,
                    ]
                );
            } else {
                await ds.query(
                    `
                    INSERT INTO "ai_intent_anchors" (
                        "anchor_key", "domain_category", "sub_intent", "locale",
                        "phrase", "content_hash", "embedding_model", "dimensions",
                        "embedding_f64", "metadata", "is_active", "updated_at"
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9::float8[], $10::jsonb, $11, now()
                    )
                    ON CONFLICT ("anchor_key") DO UPDATE SET
                        "domain_category" = EXCLUDED."domain_category",
                        "sub_intent" = EXCLUDED."sub_intent",
                        "locale" = EXCLUDED."locale",
                        "phrase" = EXCLUDED."phrase",
                        "content_hash" = EXCLUDED."content_hash",
                        "embedding_model" = EXCLUDED."embedding_model",
                        "dimensions" = EXCLUDED."dimensions",
                        "embedding_f64" = EXCLUDED."embedding_f64",
                        "metadata" = EXCLUDED."metadata",
                        "is_active" = EXCLUDED."is_active",
                        "updated_at" = now()
                    `,
                    [
                        anchorKey,
                        domain,
                        subIntent,
                        locale,
                        String(anchor.phrase || '').trim(),
                        String(anchor.contentHash || '').slice(0, 64),
                        model,
                        AI_EMBEDDING_DIMENSIONS,
                        vector,
                        metadataJson,
                        isActive,
                    ]
                );
            }
            count += 1;
        }
        return count;
    }

    async searchIntentAnchors(params: {
        queryVector: number[];
        locale?: string;
        topK?: number;
        minSimilarity?: number;
    }): Promise<IntentAnchorMatch[]> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();

        const vector = this.validateVector(params.queryVector, 'searchIntentAnchors');
        const topK = Math.max(1, Math.min(50, Math.trunc(params.topK ?? 5)));
        const minSimilarity = Number.isFinite(params.minSimilarity)
            ? Number(params.minSimilarity)
            : 0;
        const locale = params.locale?.trim() || null;

        let rows: any[];
        if (this.backend === 'pgvector') {
            const vecLiteral = this.toPgVectorLiteral(vector);
            const localeClause = locale ? `AND ("locale" = $4 OR "locale" = 'all')` : '';
            const queryParams = locale
                ? [vecLiteral, minSimilarity, topK, locale]
                : [vecLiteral, minSimilarity, topK];

            rows = this.extractRows(
                await ds.query(
                    `
                    SELECT
                        "id",
                        "anchor_key",
                        "domain_category",
                        "sub_intent",
                        "locale",
                        "phrase",
                        "metadata",
                        (1 - ("embedding_vector" <=> $1::vector)) AS similarity
                    FROM "ai_intent_anchors"
                    WHERE "is_active" = true
                      AND "embedding_vector" IS NOT NULL
                      AND (1 - ("embedding_vector" <=> $1::vector)) >= $2
                      ${localeClause}
                    ORDER BY "embedding_vector" <=> $1::vector ASC
                    LIMIT $3
                    `,
                    queryParams
                )
            );
        } else {
            const localeClause = locale ? `AND ("locale" = $4 OR "locale" = 'all')` : '';
            const queryParams = locale
                ? [vector, minSimilarity, topK, locale]
                : [vector, minSimilarity, topK];

            // Full scan without pgvector: filter first, then score each row exactly once.
            rows = this.extractRows(
                await ds.query(
                    `
                    SELECT * FROM (
                        SELECT
                            "id",
                            "anchor_key",
                            "domain_category",
                            "sub_intent",
                            "locale",
                            "phrase",
                            "metadata",
                            ai_cosine_similarity_f64("embedding_f64", $1::float8[]) AS similarity
                        FROM "ai_intent_anchors"
                        WHERE "is_active" = true
                          ${localeClause}
                    ) scored
                    WHERE scored.similarity >= $2
                    ORDER BY scored.similarity DESC
                    LIMIT $3
                    `,
                    queryParams
                )
            );
        }

        return rows.map((r) => ({
            id: String(r.id),
            anchorKey: String(r.anchor_key),
            domainCategory: String(r.domain_category) as AiDomainCategory,
            subIntent: r.sub_intent ? String(r.sub_intent) : null,
            locale: String(r.locale || 'pt'),
            phrase: String(r.phrase || ''),
            similarity: Number(r.similarity) || 0,
            metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, any>,
        }));
    }

    async getExistingRagChunkHashes(params: {
        sourceType: AllowedRagSourceType;
        userId?: string | null;
        sourceIds?: string[];
    }): Promise<Map<string, string>> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();
        const { sourceType, ownerScope } = this.assertAllowedRagSource(
            params.sourceType,
            params.userId
        );

        const hasSourceFilter =
            Array.isArray(params.sourceIds) && params.sourceIds.length > 0;
        const sql = hasSourceFilter
            ? `SELECT "source_id", "chunk_index", "content_hash" FROM "ai_rag_chunks" WHERE "owner_scope" = $1 AND "source_type" = $2 AND "source_id" = ANY($3::varchar[])`
            : `SELECT "source_id", "chunk_index", "content_hash" FROM "ai_rag_chunks" WHERE "owner_scope" = $1 AND "source_type" = $2`;
        const rows = this.extractRows(
            await ds.query(
                sql,
                hasSourceFilter
                    ? [ownerScope, sourceType, params.sourceIds]
                    : [ownerScope, sourceType]
            )
        );

        const hashes = new Map<string, string>();
        for (const r of rows) {
            if (r?.source_id !== undefined && r?.content_hash) {
                hashes.set(
                    `${String(r.source_id)}:${Number(r.chunk_index) || 0}`,
                    String(r.content_hash)
                );
            }
        }
        return hashes;
    }

    async upsertRagChunks(chunks: UpsertRagChunkInput[]): Promise<number> {
        if (!Array.isArray(chunks) || chunks.length === 0) return 0;
        await this.ensureInitialized();
        const ds = this.requireDataSource();

        let count = 0;
        for (const chunk of chunks) {
            const { sourceType, ownerScope, resolvedUserId } =
                this.assertAllowedRagSource(chunk.sourceType, chunk.userId);
            const sourceId = String(chunk.sourceId || '').trim().slice(0, 128);
            if (!sourceId) {
                throw new Error('sourceId is required for RAG chunk upsert');
            }

            const chunkIndex = Math.max(0, Math.trunc(chunk.chunkIndex ?? 0));
            const vector = this.validateVector(
                chunk.embedding,
                `rag:${sourceType}:${sourceId}:${chunkIndex}`
            );
            const accountId =
                resolvedUserId && chunk.accountId
                    ? String(chunk.accountId).trim().slice(0, 64)
                    : null;
            const title = chunk.title ? String(chunk.title).trim().slice(0, 240) : null;
            const model = String(
                chunk.embeddingModel || DEFAULT_GEMINI_EMBEDDING_MODEL
            ).slice(0, 80);
            const metadataJson = JSON.stringify(chunk.metadata || {});

            if (this.backend === 'pgvector') {
                const vecLiteral = this.toPgVectorLiteral(vector);
                await ds.query(
                    `
                    INSERT INTO "ai_rag_chunks" (
                        "owner_scope", "user_id", "account_id", "source_type",
                        "source_id", "chunk_index", "title", "content",
                        "content_hash", "embedding_model", "dimensions",
                        "embedding_f64", "embedding_vector", "metadata", "updated_at"
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9, $10, $11,
                        $12::float8[], $13::vector, $14::jsonb, now()
                    )
                    ON CONFLICT ("owner_scope", "source_type", "source_id", "chunk_index") DO UPDATE SET
                        "account_id" = EXCLUDED."account_id",
                        "title" = EXCLUDED."title",
                        "content" = EXCLUDED."content",
                        "content_hash" = EXCLUDED."content_hash",
                        "embedding_model" = EXCLUDED."embedding_model",
                        "dimensions" = EXCLUDED."dimensions",
                        "embedding_f64" = EXCLUDED."embedding_f64",
                        "embedding_vector" = EXCLUDED."embedding_vector",
                        "metadata" = EXCLUDED."metadata",
                        "updated_at" = now()
                    `,
                    [
                        ownerScope,
                        resolvedUserId,
                        accountId,
                        sourceType,
                        sourceId,
                        chunkIndex,
                        title,
                        String(chunk.content || ''),
                        String(chunk.contentHash || '').slice(0, 64),
                        model,
                        AI_EMBEDDING_DIMENSIONS,
                        vector,
                        vecLiteral,
                        metadataJson,
                    ]
                );
            } else {
                await ds.query(
                    `
                    INSERT INTO "ai_rag_chunks" (
                        "owner_scope", "user_id", "account_id", "source_type",
                        "source_id", "chunk_index", "title", "content",
                        "content_hash", "embedding_model", "dimensions",
                        "embedding_f64", "metadata", "updated_at"
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9, $10, $11,
                        $12::float8[], $13::jsonb, now()
                    )
                    ON CONFLICT ("owner_scope", "source_type", "source_id", "chunk_index") DO UPDATE SET
                        "account_id" = EXCLUDED."account_id",
                        "title" = EXCLUDED."title",
                        "content" = EXCLUDED."content",
                        "content_hash" = EXCLUDED."content_hash",
                        "embedding_model" = EXCLUDED."embedding_model",
                        "dimensions" = EXCLUDED."dimensions",
                        "embedding_f64" = EXCLUDED."embedding_f64",
                        "metadata" = EXCLUDED."metadata",
                        "updated_at" = now()
                    `,
                    [
                        ownerScope,
                        resolvedUserId,
                        accountId,
                        sourceType,
                        sourceId,
                        chunkIndex,
                        title,
                        String(chunk.content || ''),
                        String(chunk.contentHash || '').slice(0, 64),
                        model,
                        AI_EMBEDDING_DIMENSIONS,
                        vector,
                        metadataJson,
                    ]
                );
            }
            count += 1;
        }
        return count;
    }

    async deleteRagChunksBySource(params: {
        sourceType: AllowedRagSourceType;
        userId?: string | null;
        sourceId: string;
    }): Promise<number> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();
        const { sourceType, ownerScope } = this.assertAllowedRagSource(
            params.sourceType,
            params.userId
        );
        const sourceId = String(params.sourceId || '').trim();
        if (!sourceId) return 0;

        const res = await ds.query(
            `DELETE FROM "ai_rag_chunks" WHERE "owner_scope" = $1 AND "source_type" = $2 AND "source_id" = $3 RETURNING "id"`,
            [ownerScope, sourceType, sourceId]
        );
        return this.extractRows(res).length;
    }

    async deleteStaleRagChunks(params: {
        sourceType: AllowedRagSourceType;
        userId?: string | null;
        keepChunkKeys: string[];
    }): Promise<number> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();
        const { sourceType, ownerScope } = this.assertAllowedRagSource(
            params.sourceType,
            params.userId
        );

        const keepKeys = Array.isArray(params.keepChunkKeys)
            ? params.keepChunkKeys
                  .map((k) => String(k || '').trim())
                  .filter(Boolean)
            : [];

        const res =
            keepKeys.length === 0
                ? await ds.query(
                      `DELETE FROM "ai_rag_chunks" WHERE "owner_scope" = $1 AND "source_type" = $2 RETURNING "id"`,
                      [ownerScope, sourceType]
                  )
                : await ds.query(
                      `DELETE FROM "ai_rag_chunks" WHERE "owner_scope" = $1 AND "source_type" = $2 AND ("source_id" || ':' || "chunk_index"::text) <> ALL($3::text[]) RETURNING "id"`,
                      [ownerScope, sourceType, keepKeys]
                  );

        return this.extractRows(res).length;
    }

    async searchRagChunks(params: {
        queryVector: number[];
        userId?: string | null;
        accountId?: string | null;
        sourceTypes: AllowedRagSourceType[];
        topK?: number;
        minSimilarity?: number;
    }): Promise<RagChunkMatch[]> {
        await this.ensureInitialized();
        const ds = this.requireDataSource();

        const vector = this.validateVector(params.queryVector, 'searchRagChunks');
        if (!Array.isArray(params.sourceTypes) || params.sourceTypes.length === 0) {
            return [];
        }

        const uniqueTypes = Array.from(new Set(params.sourceTypes));
        for (const st of uniqueTypes) {
            if (!ALLOWED_RAG_SOURCE_TYPES.includes(st)) {
                throw new Error(
                    `Disallowed RAG sourceType "${st}". Allowed: ${ALLOWED_RAG_SOURCE_TYPES.join(', ')}`
                );
            }
        }

        const includePlatformDoc = uniqueTypes.includes('PLATFORM_DOC');
        const userScopedTypes = uniqueTypes.filter((t) => t !== 'PLATFORM_DOC');
        const cleanUserId =
            typeof params.userId === 'string' ? params.userId.trim() : '';

        if (userScopedTypes.length > 0 && !cleanUserId) {
            throw new Error(
                'userId is required to query personal RAG sources'
            );
        }

        const topK = Math.max(1, Math.min(30, Math.trunc(params.topK ?? 5)));
        const minSimilarity = Number.isFinite(params.minSimilarity)
            ? Number(params.minSimilarity)
            : 0;
        const cleanAccountId =
            params.accountId && params.accountId !== 'all'
                ? params.accountId.trim()
                : null;

        const queryParams: any[] = [
            this.backend === 'pgvector' ? this.toPgVectorLiteral(vector) : vector,
            minSimilarity,
            topK,
        ];

        const scopeBranches: string[] = [];
        if (includePlatformDoc) {
            scopeBranches.push(
                `("owner_scope" = '${GLOBAL_RAG_OWNER_SCOPE}' AND "user_id" IS NULL AND "source_type" = 'PLATFORM_DOC')`
            );
        }
        if (userScopedTypes.length > 0) {
            queryParams.push(cleanUserId);
            const userParamIdx = queryParams.length;
            queryParams.push(userScopedTypes);
            const typesParamIdx = queryParams.length;

            let accountClause = '';
            if (cleanAccountId) {
                queryParams.push(cleanAccountId);
                const accParamIdx = queryParams.length;
                accountClause = ` AND ("account_id" IS NULL OR "account_id" = $${accParamIdx})`;
            }

            scopeBranches.push(
                `("owner_scope" = $${userParamIdx} AND "user_id" = $${userParamIdx} AND "source_type" = ANY($${typesParamIdx}::varchar[])${accountClause})`
            );
        }

        const scopeSql = scopeBranches.join(' OR ');

        const rows = this.extractRows(
            this.backend === 'pgvector'
                ? await ds.query(
                      `
                      SELECT
                          "id",
                          "source_type",
                          "source_id",
                          "chunk_index",
                          "account_id",
                          "title",
                          "content",
                          "metadata",
                          (1 - ("embedding_vector" <=> $1::vector)) AS similarity
                      FROM "ai_rag_chunks"
                      WHERE (${scopeSql})
                        AND "embedding_vector" IS NOT NULL
                        AND (1 - ("embedding_vector" <=> $1::vector)) >= $2
                      ORDER BY "embedding_vector" <=> $1::vector ASC
                      LIMIT $3
                      `,
                      queryParams
                  )
                : await ds.query(
                      // Full scan without pgvector: scope filter first, then score each row once.
                      `
                      SELECT * FROM (
                          SELECT
                              "id",
                              "source_type",
                              "source_id",
                              "chunk_index",
                              "account_id",
                              "title",
                              "content",
                              "metadata",
                              ai_cosine_similarity_f64("embedding_f64", $1::float8[]) AS similarity
                          FROM "ai_rag_chunks"
                          WHERE (${scopeSql})
                      ) scored
                      WHERE scored.similarity >= $2
                      ORDER BY scored.similarity DESC
                      LIMIT $3
                      `,
                      queryParams
                  )
        );

        return rows.map((r) => ({
            id: String(r.id),
            sourceType: String(r.source_type) as AllowedRagSourceType,
            sourceId: String(r.source_id),
            chunkIndex: Number(r.chunk_index) || 0,
            accountId: r.account_id ? String(r.account_id) : null,
            title: r.title ? String(r.title) : null,
            content: String(r.content || ''),
            similarity: Number(r.similarity) || 0,
            metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, any>,
        }));
    }
}
