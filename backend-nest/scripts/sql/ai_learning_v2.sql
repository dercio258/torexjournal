-- =====================================================================================
-- Torex AI — learning layer v2 (glossary, private profile, feedback signals, AI lab)
-- Idempotent: safe to run more than once. PostgreSQL 13+.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend-nest/scripts/sql/ai_learning_v2.sql
--   (or: node backend-nest/scripts/run_migrations.js, which runs this file too)
--
-- The backend also creates these objects at startup; running this script first in
-- production lets you apply them in a maintenance window and with CONCURRENTLY indexes.
-- =====================================================================================

BEGIN;

-- 1. Private profile ---------------------------------------------------------------
-- What a user asked the assistant to remember (name, experience, style, markets, goal).
-- One row per user; facts kept only with consent; age is never stored.
CREATE TABLE IF NOT EXISTS ai_user_profile (
    user_id     VARCHAR      PRIMARY KEY,
    consent     VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
    facts       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT chk_ai_user_profile_consent CHECK (consent IN ('PENDING', 'GRANTED', 'DENIED'))
);

-- 2. Implicit feedback events ---------------------------------------------------------
-- Rephrase / suggestion click / link click / copy / continuation per assistant reply.
-- No message text; the user is an HMAC hash. One event per (reply, user, signal).
CREATE TABLE IF NOT EXISTS ai_feedback_events (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          UUID          NOT NULL,
    session_id          UUID          NOT NULL,
    user_hash           VARCHAR(32)   NOT NULL,
    signal              VARCHAR(24)   NOT NULL,
    weight              NUMERIC(4,2)  NOT NULL,
    intent              VARCHAR(80),
    provider            VARCHAR(40),
    domain_category     VARCHAR(40),
    semantic_memory_id  UUID,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_ai_feedback_events_signal
        CHECK (signal IN ('REPHRASE', 'SUGGESTION_CLICK', 'ACTION_CLICK', 'COPY', 'CONTINUATION'))
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_message         ON ai_feedback_events (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_signal_created  ON ai_feedback_events (signal, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_feedback_events_once      ON ai_feedback_events (message_id, user_hash, signal);
-- Trust recompute in the AI lab sums signals per shared-memory entry.
CREATE INDEX IF NOT EXISTS idx_ai_feedback_events_memory
    ON ai_feedback_events (semantic_memory_id) WHERE semantic_memory_id IS NOT NULL;

-- 3. Rejected-replies review queue ------------------------------------------------------
-- ai_message_feedback is created by the learning schema (migration 1779000000000).
DO $$
BEGIN
    IF to_regclass('public.ai_message_feedback') IS NOT NULL THEN
        ALTER TABLE ai_message_feedback ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;
        ALTER TABLE ai_message_feedback ADD COLUMN IF NOT EXISTS review_action VARCHAR(24);
        -- The admin queue lists only unreviewed 👎, newest first.
        CREATE INDEX IF NOT EXISTS idx_ai_feedback_review_queue
            ON ai_message_feedback (created_at DESC)
            WHERE rating = -1 AND reviewed_at IS NULL;
    END IF;
END $$;

-- 4. AI lab parameters -----------------------------------------------------------------
-- Tuned memory-reuse weights/thresholds published by quant-engine/scripts/run_ai_lab.py --apply.
-- The backend re-reads them every 30 min and clamps every value to safe bounds.
CREATE TABLE IF NOT EXISTS ai_tuning_params (
    key         VARCHAR(64)  PRIMARY KEY,
    value       JSONB        NOT NULL,
    source      VARCHAR(64)  NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMIT;

-- =====================================================================================
-- Production indexes, built without blocking writes (CONCURRENTLY cannot run inside a
-- transaction, so these sit outside the block above).
-- =====================================================================================

-- 5. Behaviour review queue (/trades): closed trades with model alerts and no trader answer yet.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trades_behavior_review_pending
    ON trades (account_id, close_time DESC)
    WHERE status = 'CLOSED'
      AND jsonb_typeof("qualityFlags" -> 'behavioralMl' -> 'activeFlags') = 'array'
      AND ("qualityFlags" -> 'behavioralFeedback') IS NULL;

-- 6. Chat: latest replies of one role in a session (consent lookup, vote prompt, implicit signals).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_chat_messages_session_role_created
    ON ai_chat_messages (session_id, role, created_at DESC);

-- 7. Planner statistics for the new and changed tables.
ANALYZE ai_user_profile;
ANALYZE ai_feedback_events;
ANALYZE ai_tuning_params;
ANALYZE ai_chat_messages;
ANALYZE trades;

-- =====================================================================================
-- Optional, needs a superuser once: native vector search instead of the
-- double precision[] fallback. After it, restart the backend: the learning schema adds
-- vector(768) columns and HNSW indexes on ai_semantic_memory, ai_intent_anchors and ai_rag_chunks.
--
--   CREATE EXTENSION IF NOT EXISTS vector;
-- =====================================================================================
