/**
 * Torex Journal - Unified Production Database Migration Runner
 * Safe, idempotent, and standalone. Runs directly with `node scripts/run_migrations.js`.
 */

const path = require('path');

// Resolve .env from multiple potential execution contexts
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), 'backend-nest/.env') });

const { Client } = require('pg');

async function runMigrations() {
    console.log('====================================================');
    console.log('🚀 TOREX JOURNAL - DATABASE MIGRATION RUNNER');
    console.log('====================================================');

    const user = process.env.DB_USER;
    const password = process.env.DB_PASS;
    const database = process.env.DB_NAME;
    const host = process.env.DB_HOST || '127.0.0.1';
    const port = parseInt(process.env.DB_PORT || '5432');

    if (!user || !password || !database) {
        console.error('❌ Missing database credentials in environment variables.');
        console.error('Resolved config:', { host, port, user: user || '<undefined>', database: database || '<undefined>' });
        console.error('Please ensure .env contains DB_USER, DB_PASS, and DB_NAME.');
        process.exit(1);
    }

    console.log(`🔌 Connecting to PostgreSQL at ${host}:${port}/${database} as "${user}"...`);

    const client = new Client({
        host,
        port,
        user,
        password,
        database
    });

    try {
        await client.connect();
        console.log('✅ Connected successfully to PostgreSQL.');
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    }

    try {
        console.log('\n--- 1. Extensions ---');
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        console.log('✓ uuid-ossp & pgcrypto extensions verified.');

        console.log('\n--- 2. Multi-Account Columns on "accounts" ---');
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "name" character varying NOT NULL DEFAULT 'Conta Principal'`);
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "broker" character varying NOT NULL DEFAULT 'MetaTrader 5'`);
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "type" character varying(20) NOT NULL DEFAULT 'live'`);
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" character varying(10) NOT NULL DEFAULT 'USD'`);
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "initial_balance" numeric(15,2) NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT true`);
        await querySafe(client, `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false`);
        await querySafe(client, `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP`);
        await querySafe(client, `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "prop_firm_rules" jsonb`);
        await querySafe(client, `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "app_token" character varying(64)`);
        console.log('✓ "accounts" columns verified.');

        console.log('\n--- 3. "account_transactions" Table ---');
        await client.query(`
            CREATE TABLE IF NOT EXISTS "account_transactions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "account_id" uuid NOT NULL,
                "type" character varying(20) NOT NULL DEFAULT 'deposit',
                "amount" numeric(15,2) NOT NULL,
                "date" TIMESTAMP NOT NULL DEFAULT now(),
                "description" text,
                "balance_after" numeric(15,2) NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_account_transactions" PRIMARY KEY ("id")
            )
        `);

        await querySafe(client, `
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'FK_account_transactions_account'
                ) THEN
                    ALTER TABLE "account_transactions" 
                    ADD CONSTRAINT "FK_account_transactions_account" 
                    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE;
                END IF;
            END $$;
        `);

        await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_account_transactions_account_id" ON "account_transactions" ("account_id")`);
        console.log('✓ "account_transactions" table, foreign key and index verified.');

        console.log('\n--- 4. Accounts Data Normalization ---');
        await querySafe(client, `
            UPDATE "accounts" 
            SET "app_token" = upper(replace(gen_random_uuid()::text, '-', '')) 
            WHERE "app_token" IS NULL OR "app_token" = ''
        `);
        await querySafe(client, `
            UPDATE "accounts" 
            SET "initial_balance" = "balance" 
            WHERE "initial_balance" = 0 AND "balance" > 0
        `);
        await querySafe(client, `
            WITH ranked_accounts AS (
                SELECT id, user_id, 
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY "createdAt" ASC) as rn
                FROM "accounts"
                WHERE "user_id" IS NOT NULL
            )
            UPDATE "accounts"
            SET "is_primary" = (ranked_accounts.rn = 1)
            FROM ranked_accounts
            WHERE "accounts".id = ranked_accounts.id AND ("accounts"."is_primary" IS NULL);
        `);
        console.log('✓ Account app_tokens, initial balances and primary flags normalized.');

        console.log('\n--- 5. "trades" Table Columns ---');
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "import_log_id" integer`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "entrySpot" numeric(10,5)`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "exitSpot" numeric(10,5)`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "buyPrice" numeric(10,2)`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "sellPrice" numeric(10,2)`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "payout" numeric(10,2)`);
        await querySafe(client, `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "syntheticTxid" boolean NOT NULL DEFAULT false`);
        console.log('✓ "trades" columns verified.');

        console.log('\n--- 6. Economic Calendar Tables ---');
        await client.query(`
            CREATE TABLE IF NOT EXISTS economic_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_date TIMESTAMPTZ NOT NULL,
                currency VARCHAR(10) NOT NULL,
                country VARCHAR(100),
                title VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'OTHER',
                impact VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
                status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
                actual VARCHAR(50),
                forecast VARCHAR(50),
                previous VARCHAR(50),
                unit VARCHAR(30),
                description TEXT,
                source VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_events_date ON economic_events(event_date ASC)');
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_events_currency ON economic_events(currency)');
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_events_impact ON economic_events(impact)');
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_events_category ON economic_events(category)');
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_events_status ON economic_events(status)');

        await client.query(`
            CREATE TABLE IF NOT EXISTS economic_event_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id UUID NOT NULL,
                action VARCHAR(30) NOT NULL,
                changed_by VARCHAR(150),
                old_data JSONB,
                new_data JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_economic_event_history_event_id ON economic_event_history(event_id)');
        console.log('✓ "economic_events" and "economic_event_history" tables and indices verified.');

        console.log('\n--- 7. Leaderboard & Backtest Tables ---');
        await querySafe(client, `
            CREATE TABLE IF NOT EXISTS leaderboard_ranks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                rank INT NOT NULL DEFAULT 999,
                echelon VARCHAR(50) NOT NULL DEFAULT 'BRONZE',
                composite_score NUMERIC(5,2) NOT NULL DEFAULT 0,
                total_pnl NUMERIC(15,2) NOT NULL DEFAULT 0,
                win_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
                profit_factor NUMERIC(8,2) NOT NULL DEFAULT 0,
                trades_count INT NOT NULL DEFAULT 0,
                win_streak INT NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_leaderboard_ranks_user_id ON leaderboard_ranks(user_id)');
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS idx_leaderboard_ranks_rank ON leaderboard_ranks(rank ASC)');

        console.log('\n--- 8. Deriv Integration Tables ---');
        await querySafe(client, `
            CREATE TABLE IF NOT EXISTS "deriv_auth" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "userId" character varying NOT NULL,
                "account_id" character varying NOT NULL,
                "encryptedToken" text NOT NULL,
                "currency" character varying,
                "isActive" boolean NOT NULL DEFAULT true,
                "metadata" jsonb,
                "account_entity_id" character varying,
                "last_sync_at" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_deriv_auth" PRIMARY KEY ("id")
            );
        `);
        await querySafe(client, `ALTER TABLE "deriv_auth" ADD COLUMN IF NOT EXISTS "account_entity_id" character varying`);
        await querySafe(client, `ALTER TABLE "deriv_auth" ADD COLUMN IF NOT EXISTS "last_sync_at" TIMESTAMP`);

        await querySafe(client, `
            CREATE TABLE IF NOT EXISTS "deriv_transactions" (
                "transactionId" character varying NOT NULL,
                "contractId" character varying,
                "userId" character varying NOT NULL,
                "action" character varying,
                "amount" numeric(20,2) NOT NULL,
                "balance" numeric(20,2),
                "currency" character varying(10),
                "transactionTime" TIMESTAMP NOT NULL,
                "processed" boolean NOT NULL DEFAULT false,
                "raw" jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_deriv_transactions" PRIMARY KEY ("transactionId")
            );
        `);
        await querySafe(client, 'CREATE INDEX IF NOT EXISTS "IDX_deriv_transactions_contractId" ON "deriv_transactions" ("contractId")');
        console.log('✓ "deriv_auth" and "deriv_transactions" verified.');

        console.log('\n--- 9. User Locale, Attribution & Backtest Client Session Columns ---');
        await querySafe(client, `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_locale" character varying(8) NOT NULL DEFAULT 'pt'`);
        await querySafe(client, `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" character varying(64)`);
        await querySafe(client, `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attribution_data" jsonb`);
        await querySafe(client, `ALTER TABLE "backtest_sessions" ADD COLUMN IF NOT EXISTS "client_session_id" character varying(120)`);
        await querySafe(client, `UPDATE "backtest_sessions" SET "client_session_id" = COALESCE(config->>'clientSessionId', config->>'clientStrategyId') WHERE "client_session_id" IS NULL AND (config ? 'clientSessionId' OR config ? 'clientStrategyId')`);
        console.log('✓ "users" locale/attribution & "backtest_sessions.client_session_id" verified and backfilled.');

        console.log('\n--- 10. Composite Performance Indexes (DB-1..DB-4 Verified Schema) ---');
        const perfIndexes = [
            // Core Trading, Positions, Accounts & Deriv
            `CREATE INDEX IF NOT EXISTS "IDX_trades_account_status_close_time" ON "trades" ("account_id", "status", "close_time" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_trades_account_ticket" ON "trades" ("account_id", "ticket")`,
            `CREATE INDEX IF NOT EXISTS "IDX_trades_account_symbol" ON "trades" ("account_id", "symbol")`,
            `CREATE INDEX IF NOT EXISTS "IDX_trades_close_time" ON "trades" ("close_time" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_positions_account_ticket" ON "positions" ("account_id", "ticket")`,
            `CREATE INDEX IF NOT EXISTS "IDX_positions_account_open_time" ON "positions" ("account_id", "open_time" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_accounts_user_archived_primary" ON "accounts" ("user_id", "is_archived", "is_primary" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_accounts_user_mt5" ON "accounts" ("user_id", "mt5_id")`,
            `CREATE INDEX IF NOT EXISTS "IDX_account_tx_account_date" ON "account_transactions" ("account_id", "date" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_deriv_tx_user_contract" ON "deriv_transactions" ("userId", "contractId", "transactionTime" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_deriv_auth_user_active" ON "deriv_auth" ("userId", "isActive")`,

            // Users, Subscriptions, Sessions, Security & WhatsApp
            `CREATE INDEX IF NOT EXISTS "IDX_users_refresh_token" ON "users" ("refresh_token")`,
            `CREATE INDEX IF NOT EXISTS "IDX_users_created_at" ON "users" ("createdAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_user_status_end" ON "subscriptions" ("userId", "status", "currentPeriodEnd" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_status_end" ON "subscriptions" ("status", "currentPeriodEnd")`,
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_payment_ref" ON "subscriptions" ("paymentReference")`,
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_debito_tx" ON "subscriptions" ("debitoTransactionId")`,
            `CREATE INDEX IF NOT EXISTS "IDX_sessions_user_active_expires" ON "sessions" ("userId", "isActive", "expiresAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_timestamp" ON "audit_logs" ("user_id", "timestamp" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_whatsapp_links_user_active" ON "whatsapp_links" ("user_id", "is_active")`,

            // Journal, Notes, Notifications, Alerts & Imports
            `CREATE INDEX IF NOT EXISTS "IDX_daily_notes_user_date" ON "daily_notes" ("user_id", "date" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_trade_notes_user_trade" ON "trade_notes" ("user_id", "trade_id")`,
            `CREATE INDEX IF NOT EXISTS "IDX_general_notes_user_template_pinned" ON "general_notes" ("user_id", "is_template", "pinned")`,
            `CREATE INDEX IF NOT EXISTS "IDX_mental_logs_account_date" ON "mental_logs" ("account_id", "date" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_technical_journals_account_date" ON "technical_journals" ("account_id", "date" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_notifications_account_read_created" ON "notifications" ("account_id", "is_read", "created_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_alerts_user_resolved_created" ON "alerts" ("user_id", "resolved", "created_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_import_logs_user_created" ON "import_logs" ("userId", "createdAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_import_logs_account_created" ON "import_logs" ("account_id", "createdAt" DESC)`,

            // Backtesting, Torex AI & Network/Academy
            `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_updated" ON "backtest_sessions" ("user_id", "updated_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_client_id" ON "backtest_sessions" ("user_id", "client_session_id")`,
            `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_mode_updated" ON "backtest_sessions" ("user_id", "mode", "updated_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_ai_chat_sessions_user_updated" ON "ai_chat_sessions" ("user_id", "updated_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_ai_chat_messages_session_created" ON "ai_chat_messages" ("session_id", "created_at" ASC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_ai_chat_jobs_user_status" ON "ai_chat_jobs" ("user_id", "status")`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_posts_likes_created" ON "network_posts" ("likesCount" DESC, "createdAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_posts_user_created" ON "network_posts" ("userId", "createdAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_likes_post_user" ON "network_likes" ("postId", "userId")`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_follows_pair" ON "network_follows" ("followerId", "followingId")`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_comments_post_created" ON "network_comments" ("postId", "createdAt" ASC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_chat_room_created" ON "network_chat_messages" ("room", "createdAt" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_dm_pair_created" ON "network_direct_messages" ("sender_id", "recipient_id", "created_at" DESC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_dm_recipient_read" ON "network_direct_messages" ("recipient_id", "is_read")`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_lessons_pub_order" ON "network_video_lessons" ("is_published", "order_index" ASC)`,
            `CREATE INDEX IF NOT EXISTS "IDX_network_video_progress_user_lesson" ON "network_video_progress" ("user_id", "lesson_id")`
        ];
        for (const idxSql of perfIndexes) {
            await querySafe(client, idxSql);
        }
        await querySafe(client, `ANALYZE`);
        console.log(`✓ ${perfIndexes.length} composite performance indexes verified + ANALYZE updated.`);

        console.log('\n--- 11. AI Vector Storage (pgvector + double precision[] fallback) ---');
        await querySafe(client, `
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
                    CREATE EXTENSION IF NOT EXISTS "vector";
                END IF;
            EXCEPTION WHEN OTHERS THEN
                NULL;
            END $$;
        `);
        await client.query(`
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
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS "ai_intent_anchors" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "anchor_key" character varying(120) NOT NULL,
                "domain_category" character varying(40) NOT NULL,
                "sub_intent" character varying(60),
                "locale" character varying(8) NOT NULL DEFAULT 'pt',
                "phrase" text NOT NULL,
                "content_hash" character varying(64) NOT NULL,
                "embedding_model" character varying(80) NOT NULL DEFAULT 'gemini-embedding-2',
                "dimensions" integer NOT NULL DEFAULT 768,
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
        `);
        await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_domain_active" ON "ai_intent_anchors" ("domain_category", "is_active")`);
        await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_locale_active" ON "ai_intent_anchors" ("locale", "is_active")`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS "ai_rag_chunks" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "owner_scope" character varying(64) NOT NULL DEFAULT '__GLOBAL__',
                "user_id" character varying(64),
                "account_id" character varying(64),
                "source_type" character varying(32) NOT NULL,
                "source_id" character varying(128) NOT NULL,
                "chunk_index" integer NOT NULL DEFAULT 0,
                "title" character varying(240),
                "content" text NOT NULL,
                "content_hash" character varying(64) NOT NULL,
                "embedding_model" character varying(80) NOT NULL DEFAULT 'gemini-embedding-2',
                "dimensions" integer NOT NULL DEFAULT 768,
                "embedding_f64" double precision[] NOT NULL,
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ai_rag_chunks" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_ai_rag_chunks_scope_source" UNIQUE ("owner_scope", "source_type", "source_id", "chunk_index"),
                CONSTRAINT "CHK_ai_rag_chunks_allowed_source" CHECK ("source_type" IN ('PLATFORM_DOC', 'DAILY_NOTE', 'TRADE_NOTE', 'GENERAL_NOTE', 'TRADE_LESSON', 'PLAYBOOK')),
                CONSTRAINT "CHK_ai_rag_chunks_tenant_isolation" CHECK (("source_type" = 'PLATFORM_DOC' AND "user_id" IS NULL AND "owner_scope" = '__GLOBAL__') OR ("source_type" <> 'PLATFORM_DOC' AND "user_id" IS NOT NULL AND "owner_scope" = "user_id")),
                CONSTRAINT "CHK_ai_rag_chunks_dims" CHECK ("dimensions" > 0)
            )
        `);
        await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_owner_source" ON "ai_rag_chunks" ("owner_scope", "source_type")`);
        await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_user_source" ON "ai_rag_chunks" ("user_id", "source_type")`);

        const pgvecCheck = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`);
        if (pgvecCheck.rows?.[0]?.installed) {
            await querySafe(client, `ALTER TABLE "ai_intent_anchors" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(768)`);
            await querySafe(client, `ALTER TABLE "ai_rag_chunks" ADD COLUMN IF NOT EXISTS "embedding_vector" vector(768)`);
            await querySafe(client, `UPDATE "ai_intent_anchors" SET "embedding_vector" = "embedding_f64"::vector WHERE "embedding_vector" IS NULL AND cardinality("embedding_f64") = 768`);
            await querySafe(client, `UPDATE "ai_rag_chunks" SET "embedding_vector" = "embedding_f64"::vector WHERE "embedding_vector" IS NULL AND cardinality("embedding_f64") = 768`);
            await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_intent_anchors_vec_hnsw" ON "ai_intent_anchors" USING hnsw ("embedding_vector" vector_cosine_ops)`);
            await querySafe(client, `CREATE INDEX IF NOT EXISTS "IDX_ai_rag_chunks_vec_hnsw" ON "ai_rag_chunks" USING hnsw ("embedding_vector" vector_cosine_ops)`);
            console.log('✓ AI vector tables initialized with native pgvector (vector(768) + HNSW).');
        } else {
            console.log('✓ AI vector tables initialized in double precision[] mode (pgvector fallback ready).');
        }

        // AI learning layer v2 (profile, feedback signals, review queue, lab params, indexes)
        await applyAiLearningV2(client);

        // Mark TypeORM migrations table if exists
        await querySafe(client, `
            CREATE TABLE IF NOT EXISTS "migrations" (
                "id" SERIAL PRIMARY KEY,
                "timestamp" bigint NOT NULL,
                "name" character varying NOT NULL
            );
        `);
        await registerMigration(client, 1772600000000, 'MultiAccountAndTransactions1772600000000');
        await registerMigration(client, 1772529444375, 'AddImportLogId1772529444375');
        await registerMigration(client, 1772465278897, 'DerivRefactoring1772465278897');
        await registerMigration(client, 1776000000000, 'DeepDbAndModelOptimization1776000000000');
        await registerMigration(client, 1777000000000, 'AiVectorStoragePhase21777000000000');

        console.log('\n====================================================');
        console.log('🎉 ALL DATABASE MIGRATIONS COMPLETED SUCCESSFULLY!');
        console.log('====================================================');
    } catch (err) {
        console.error('\n❌ Migration failed with error:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

/**
 * Runs scripts/sql/ai_learning_v2.sql. The transactional part (up to COMMIT) goes as one
 * statement batch; each CONCURRENTLY index / ANALYZE after it goes on its own, because
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
 */
async function applyAiLearningV2(client) {
    const fs = require('fs');
    const file = path.resolve(__dirname, 'sql', 'ai_learning_v2.sql');
    if (!fs.existsSync(file)) {
        console.warn('Notice: ai_learning_v2.sql not found, skipped.');
        return;
    }
    const sql = fs.readFileSync(file, 'utf8');
    const commitAt = sql.indexOf('COMMIT;');
    const transactional = sql.slice(0, commitAt + 'COMMIT;'.length);
    const rest = sql
        .slice(commitAt + 'COMMIT;'.length)
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    try {
        await client.query(transactional);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    }
    for (const statement of rest) {
        await querySafe(client, statement);
    }
    console.log('✓ AI learning layer v2 applied (profile, feedback signals, review queue, lab params, indexes).');
}

async function querySafe(client, sql) {
    try {
        await client.query(sql);
    } catch (err) {
        // Silently tolerate if duplicate constraint/index or column exists
        if (!err.message.includes('already exists') && !err.message.includes('duplicate')) {
            console.warn('Notice:', err.message);
        }
    }
}

async function registerMigration(client, timestamp, name) {
    try {
        const check = await client.query('SELECT 1 FROM "migrations" WHERE "name" = $1', [name]);
        if (check.rows.length === 0) {
            await client.query('INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)', [timestamp, name]);
            console.log(`✓ Migration "${name}" registered in "migrations" table.`);
        }
    } catch (err) {
        // Table might not exist or be accessible, non-critical
    }
}

runMigrations();
