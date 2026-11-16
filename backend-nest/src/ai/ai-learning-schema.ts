import {
    AI_EMBEDDING_DIMENSIONS,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    VectorSchemaQueryExecutor,
} from './ai-vector-schema';

export const GLOBAL_MEMORY_OWNER_SCOPE = '__GLOBAL__';

export const ALLOWED_FEEDBACK_REASON_CODES = [
    'HELPFUL',
    'ACCURATE',
    'INACCURATE',
    'WRONG_INTENT',
    'GENERIC',
    'INCOMPLETE',
    'UNSAFE',
    'OTHER',
] as const;

export type FeedbackReasonCode = (typeof ALLOWED_FEEDBACK_REASON_CODES)[number];

export const MEMORY_SCOPES = [
    'GLOBAL_SAFE',
    'GLOBAL_INTENT_PATTERN',
    'USER_PRIVATE',
] as const;

export type SemanticMemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_STATUSES = [
    'CANDIDATE',
    'ACTIVE',
    'QUARANTINED',
    'RETIRED',
] as const;

export type SemanticMemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface LearningSchemaApplyResult {
    pgvectorEnabled: boolean;
    pgTrgmEnabled: boolean;
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

export const AI_LEARNING_BASE_DDL_STATEMENTS: string[] = [
    AI_COSINE_SIMILARITY_FN_SQL,
    `
    CREATE TABLE IF NOT EXISTS "ai_message_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "message_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "user_id" character varying(64) NOT NULL,
        "rating" smallint NOT NULL,
        "reason_code" character varying(40),
        "correction_note" text,
        "locale" character varying(8) NOT NULL DEFAULT 'pt',
        "domain_category" character varying(40),
        "intent" character varying(80),
        "router_decision" character varying(40),
        "router_model" character varying(80),
        "analyst_model" character varying(80),
        "semantic_memory_id" uuid,
        "matched_anchor_key" character varying(120),
        "normalized_question" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_message_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_message_feedback_msg_user" UNIQUE ("message_id", "user_id"),
        CONSTRAINT "CHK_ai_message_feedback_rating" CHECK ("rating" IN (-1, 1))
    )
    `.trim(),
    `CREATE INDEX IF NOT EXISTS "IDX_ai_feedback_rating_created" ON "ai_message_feedback" ("rating", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_ai_feedback_domain_rating" ON "ai_message_feedback" ("domain_category", "rating")`,
    `CREATE INDEX IF NOT EXISTS "IDX_ai_feedback_memory_id" ON "ai_message_feedback" ("semantic_memory_id")`,
    `
    CREATE TABLE IF NOT EXISTS "ai_semantic_memory" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope_level" character varying(32) NOT NULL,
        "owner_scope" character varying(64) NOT NULL DEFAULT '${GLOBAL_MEMORY_OWNER_SCOPE}',
        "user_id" character varying(64),
        "account_id" character varying(64),
        "locale" character varying(8) NOT NULL DEFAULT 'pt',
        "domain_category" character varying(40) NOT NULL,
        "sub_intent" character varying(60),
        "intent_key" character varying(80),
        "canonical_question" text NOT NULL,
        "normalized_question" text NOT NULL,
        "content_hash" character varying(64) NOT NULL,
        "variant_phrases" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "embedding_model" character varying(80) NOT NULL DEFAULT '${DEFAULT_GEMINI_EMBEDDING_MODEL}',
        "dimensions" integer NOT NULL DEFAULT ${AI_EMBEDDING_DIMENSIONS},
        "embedding_f64" double precision[] NOT NULL,
        "cached_reply" text,
        "handoff_template" jsonb,
        "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "suggestions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'CANDIDATE',
        "positive_count" integer NOT NULL DEFAULT 0,
        "negative_count" integer NOT NULL DEFAULT 0,
        "distinct_positive_users" integer NOT NULL DEFAULT 0,
        "positive_user_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "hit_count" integer NOT NULL DEFAULT 0,
        "llm_tokens_saved" bigint NOT NULL DEFAULT 0,
        "trust_score" double precision NOT NULL DEFAULT 0.50,
        "platform_doc_version" character varying(64),
        "last_hit_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_semantic_memory" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_semantic_memory_scope_hash" UNIQUE ("owner_scope", "scope_level", "locale", "content_hash"),
        CONSTRAINT "CHK_ai_semantic_memory_status" CHECK ("status" IN ('CANDIDATE', 'ACTIVE', 'QUARANTINED', 'RETIRED')),
        CONSTRAINT "CHK_ai_semantic_memory_domain" CHECK ("domain_category" IN ('TRADING_CONCEPTS', 'PLATFORM_KNOWLEDGE', 'PERSONAL_ANALYTICS')),
        CONSTRAINT "CHK_ai_semantic_memory_dims" CHECK ("dimensions" >= 0),
        CONSTRAINT "CHK_ai_semantic_memory_tenant_safety" CHECK (
            ("scope_level" = 'GLOBAL_SAFE' AND "owner_scope" = '${GLOBAL_MEMORY_OWNER_SCOPE}' AND "user_id" IS NULL AND "domain_category" IN ('TRADING_CONCEPTS', 'PLATFORM_KNOWLEDGE') AND "cached_reply" IS NOT NULL)
            OR ("scope_level" = 'GLOBAL_INTENT_PATTERN' AND "owner_scope" = '${GLOBAL_MEMORY_OWNER_SCOPE}' AND "user_id" IS NULL AND "cached_reply" IS NULL)
            OR ("scope_level" = 'USER_PRIVATE' AND "user_id" IS NOT NULL AND "owner_scope" = "user_id")
        )
    )
    `.trim(),
    `CREATE INDEX IF NOT EXISTS "IDX_ai_memory_lookup" ON "ai_semantic_memory" ("owner_scope", "status", "locale", "domain_category")`,
    `CREATE INDEX IF NOT EXISTS "IDX_ai_memory_fts_question" ON "ai_semantic_memory" USING gin (to_tsvector('simple', coalesce("normalized_question", '')))`,
    `
    CREATE TABLE IF NOT EXISTS "ai_lexical_synonyms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "surface_term" character varying(120) NOT NULL,
        "normalized_surface" character varying(120) NOT NULL,
        "canonical_term" character varying(120) NOT NULL,
        "intent_key" character varying(80),
        "domain_category" character varying(40),
        "locale" character varying(8) NOT NULL DEFAULT 'pt',
        "embedding_f64" double precision[],
        "co_occurrence_count" integer NOT NULL DEFAULT 1,
        "positive_weight" double precision NOT NULL DEFAULT 1.0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_lexical_synonyms" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_lexical_synonyms_term" UNIQUE ("locale", "normalized_surface", "canonical_term")
    )
    `.trim(),
    `CREATE INDEX IF NOT EXISTS "IDX_ai_synonyms_locale_active" ON "ai_lexical_synonyms" ("locale", "is_active")`,
];

function extractRows(res: any): any[] {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.rows)) return res.rows;
    return [];
}

/**
 * Applies idempotent DDL for Torex AI feedback, self-growing semantic memory,
 * and closest-word lexical synonyms (with optional pgvector & pg_trgm extensions).
 */
export async function applyAiLearningSchema(
    executor: VectorSchemaQueryExecutor,
    dimensions = AI_EMBEDDING_DIMENSIONS
): Promise<LearningSchemaApplyResult> {
    let pgvectorEnabled = false;
    let pgTrgmEnabled = false;

    try {
        await executor.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
                    CREATE EXTENSION IF NOT EXISTS "vector";
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END $$;
        `);
        await executor.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
                    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END $$;
        `);

        const extRes = await executor.query(
            `SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`
        );
        const rows = extractRows(extRes);
        pgvectorEnabled = rows.some((r: any) => r?.extname === 'vector');
        pgTrgmEnabled = rows.some((r: any) => r?.extname === 'pg_trgm');
    } catch {
        pgvectorEnabled = false;
        pgTrgmEnabled = false;
    }

    for (const stmt of AI_LEARNING_BASE_DDL_STATEMENTS) {
        await executor.query(stmt);
    }

    const safeDims = Math.max(1, Math.trunc(dimensions));
    if (pgvectorEnabled) {
        try {
            await executor.query(
                `ALTER TABLE "ai_semantic_memory" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(${safeDims})`
            );
            await executor.query(
                `UPDATE "ai_semantic_memory" SET "embedding_vector" = "embedding_f64"::vector WHERE "embedding_vector" IS NULL AND cardinality("embedding_f64") = ${safeDims}`
            );
            await executor.query(
                `CREATE INDEX IF NOT EXISTS "IDX_ai_memory_vec_hnsw" ON "ai_semantic_memory" USING hnsw ("embedding_vector" vector_cosine_ops)`
            );
        } catch {
            pgvectorEnabled = false;
        }
    }

    if (pgTrgmEnabled) {
        try {
            await executor.query(
                `CREATE INDEX IF NOT EXISTS "IDX_ai_memory_trgm_question" ON "ai_semantic_memory" USING gin ("normalized_question" gin_trgm_ops)`
            );
            await executor.query(
                `CREATE INDEX IF NOT EXISTS "IDX_ai_synonyms_trgm_surface" ON "ai_lexical_synonyms" USING gin ("normalized_surface" gin_trgm_ops)`
            );
        } catch {
            pgTrgmEnabled = false;
        }
    }

    return { pgvectorEnabled, pgTrgmEnabled };
}
