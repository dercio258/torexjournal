export const AI_EMBEDDING_DIMENSIONS = 768;

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2';
export const FALLBACK_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2-preview';

export const FORBIDDEN_EMBEDDING_MODELS = [
    'text-embedding-004',
    'models/text-embedding-004',
    'embedding-001',
    'models/embedding-001',
] as const;

export const ALLOWED_RAG_SOURCE_TYPES = [
    'PLATFORM_DOC',
    'DAILY_NOTE',
    'TRADE_NOTE',
    'GENERAL_NOTE',
    'TRADE_LESSON',
    'PLAYBOOK',
] as const;

export type AllowedRagSourceType = (typeof ALLOWED_RAG_SOURCE_TYPES)[number];

export const GLOBAL_RAG_OWNER_SCOPE = '__GLOBAL__';

export interface VectorSchemaQueryExecutor {
    query: (sql: string, parameters?: any[]) => Promise<any>;
}

export interface VectorSchemaApplyResult {
    pgvectorAvailable: boolean;
    pgvectorInstalled: boolean;
}

const AI_COSINE_SIMILARITY_FN_SQL = `
CREATE OR REPLACE FUNCTION ai_cosine_similarity_f64(a double precision[], b double precision[])
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN a IS NULL OR b IS NULL OR cardinality(a) = 0 OR cardinality(a) <> cardinality(b) THEN 0::double precision
        ELSE COALESCE(
            (
                SELECT SUM(t.x * t.y) / NULLIF(SQRT(SUM(t.x * t.x)) * SQRT(SUM(t.y * t.y)), 0)
                FROM unnest(a, b) AS t(x, y)
            ),
            0::double precision
        )
    END;
$$;
`.trim();

export const AI_VECTOR_BASE_DDL_STATEMENTS: string[] = [
    AI_COSINE_SIMILARITY_FN_SQL,
    `
    CREATE TABLE IF NOT EXISTS "ai_intent_anchors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "anchor_key" character varying(120) NOT NULL,
        "domain_category" character varying(40) NOT NULL,
        "sub_intent" character varying(60),
        "locale" character varying(8) NOT NULL DEFAULT 'pt',
        "phrase" text NOT NULL,
        "content_hash" character varying(64) NOT NULL,
        "embedding_model" character varying(80) NOT NULL DEFAULT '${DEFAULT_GEMINI_EMBEDDING_MODEL}',
        "dimensions" integer NOT NULL DEFAULT ${AI_EMBEDDING_DIMENSIONS},
        "embedding_f64" double precision[] NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_intent_anchors" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_intent_anchors_key" UNIQUE ("anchor_key"),
        CONSTRAINT "CHK_ai_intent_anchors_domain" CHECK ("domain_category" IN ('TRADING_CONCEPTS', 'PLATFORM_KNOWLEDGE', 'PERSONAL_ANALYTICS')),
        CONSTRAINT "CHK_ai_intent_anchors_dims" CHECK ("dimensions" > 0)
    )
    `.trim(),
    `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_domain_active" ON "ai_intent_anchors" ("domain_category", "is_active")`,
    `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_locale_active" ON "ai_intent_anchors" ("locale", "is_active")`,
    `
    CREATE TABLE IF NOT EXISTS "ai_rag_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_scope" character varying(64) NOT NULL DEFAULT '${GLOBAL_RAG_OWNER_SCOPE}',
        "user_id" character varying(64),
        "account_id" character varying(64),
        "source_type" character varying(32) NOT NULL,
        "source_id" character varying(128) NOT NULL,
        "chunk_index" integer NOT NULL DEFAULT 0,
        "title" character varying(240),
        "content" text NOT NULL,
        "content_hash" character varying(64) NOT NULL,
        "embedding_model" character varying(80) NOT NULL DEFAULT '${DEFAULT_GEMINI_EMBEDDING_MODEL}',
        "dimensions" integer NOT NULL DEFAULT ${AI_EMBEDDING_DIMENSIONS},
        "embedding_f64" double precision[] NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_rag_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_rag_chunks_scope_source" UNIQUE ("owner_scope", "source_type", "source_id", "chunk_index"),
        CONSTRAINT "CHK_ai_rag_chunks_allowed_source" CHECK ("source_type" IN ('PLATFORM_DOC', 'DAILY_NOTE', 'TRADE_NOTE', 'GENERAL_NOTE', 'TRADE_LESSON', 'PLAYBOOK')),
        CONSTRAINT "CHK_ai_rag_chunks_tenant_isolation" CHECK (("source_type" = 'PLATFORM_DOC' AND "user_id" IS NULL AND "owner_scope" = '${GLOBAL_RAG_OWNER_SCOPE}') OR ("source_type" <> 'PLATFORM_DOC' AND "user_id" IS NOT NULL AND "owner_scope" = "user_id")),
        CONSTRAINT "CHK_ai_rag_chunks_dims" CHECK ("dimensions" > 0)
    )
    `.trim(),
    `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_owner_source" ON "ai_rag_chunks" ("owner_scope", "source_type")`,
    `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_user_source" ON "ai_rag_chunks" ("user_id", "source_type")`,
];

export const AI_PGVECTOR_UPGRADE_STATEMENTS = (
    dimensions = AI_EMBEDDING_DIMENSIONS
): string[] => {
    const safeDims = Math.max(1, Math.trunc(dimensions));
    return [
        `ALTER TABLE "ai_intent_anchors" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(${safeDims})`,
        `ALTER TABLE "ai_rag_chunks" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(${safeDims})`,
        `UPDATE "ai_intent_anchors" SET "embedding_vector" = "embedding_f64"::vector WHERE "embedding_vector" IS NULL AND cardinality("embedding_f64") = ${safeDims}`,
        `UPDATE "ai_rag_chunks" SET "embedding_vector" = "embedding_f64"::vector WHERE "embedding_vector" IS NULL AND cardinality("embedding_f64") = ${safeDims}`,
        `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_vec_hnsw" ON "ai_intent_anchors" USING hnsw ("embedding_vector" vector_cosine_ops)`,
        `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_vec_hnsw" ON "ai_rag_chunks" USING hnsw ("embedding_vector" vector_cosine_ops)`,
    ];
};

function extractRows(res: any): any[] {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.rows)) return res.rows;
    return [];
}

/**
 * Applies idempotent AI vector storage DDL (PostgreSQL pgvector with automatic
 * double precision[] fallback when the pgvector extension is not installed).
 */
export async function applyAiVectorSchema(
    executor: VectorSchemaQueryExecutor,
    dimensions = AI_EMBEDDING_DIMENSIONS
): Promise<VectorSchemaApplyResult> {
    let pgvectorAvailable = false;
    let pgvectorInstalled = false;

    try {
        const probe = await executor.query(`
            SELECT
                EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS pgvector_available,
                EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector_installed
        `);
        const row = extractRows(probe)[0];
        pgvectorAvailable = Boolean(row?.pgvector_available);
        pgvectorInstalled = Boolean(row?.pgvector_installed);
    } catch {
        pgvectorAvailable = false;
        pgvectorInstalled = false;
    }

    if (pgvectorAvailable && !pgvectorInstalled) {
        try {
            await executor.query(`
                DO $$
                BEGIN
                    CREATE EXTENSION IF NOT EXISTS "vector";
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END $$;
            `);
            const recheck = await executor.query(
                `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector_installed`
            );
            pgvectorInstalled = Boolean(extractRows(recheck)[0]?.pgvector_installed);
        } catch {
            pgvectorInstalled = false;
        }
    }

    for (const stmt of AI_VECTOR_BASE_DDL_STATEMENTS) {
        await executor.query(stmt);
    }

    if (pgvectorInstalled) {
        for (const stmt of AI_PGVECTOR_UPGRADE_STATEMENTS(dimensions)) {
            await executor.query(stmt);
        }
    }

    return { pgvectorAvailable, pgvectorInstalled };
}
