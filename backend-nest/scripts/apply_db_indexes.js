/**
 * Cria os indices compostos de performance, colunas de schema e backfill
 * no PostgreSQL em producao sem depender do synchronize: true do TypeORM.
 *
 * Uso local ou na VPS Linux:
 *   node backend-nest/scripts/apply_db_indexes.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCHEMA_PATCHES = [
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_locale" character varying(8) NOT NULL DEFAULT 'pt'`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" character varying(64)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attribution_data" jsonb`,
    `ALTER TABLE "backtest_sessions" ADD COLUMN IF NOT EXISTS "client_session_id" character varying(120)`,
    `UPDATE "backtest_sessions" SET "client_session_id" = COALESCE(config->>'clientSessionId', config->>'clientStrategyId') WHERE "client_session_id" IS NULL AND (config ? 'clientSessionId' OR config ? 'clientStrategyId')`,
];

const INDEX_STATEMENTS = [
    // Core Trading, Positions, Accounts & Deriv
    `CREATE INDEX IF NOT EXISTS "IDX_trades_account_status_close_time" ON "trades" ("account_id", "status", "close_time" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_trades_account_ticket" ON "trades" ("account_id", "ticket")`,
    `CREATE INDEX IF NOT EXISTS "IDX_trades_account_symbol" ON "trades" ("account_id", "symbol")`,
    `CREATE INDEX IF NOT EXISTS "IDX_trades_close_time" ON "trades" ("close_time" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_trades_import_log_id" ON "trades" ("import_log_id")`,
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
    `CREATE INDEX IF NOT EXISTS "IDX_network_video_progress_user_lesson" ON "network_video_progress" ("user_id", "lesson_id")`,
];

async function applyIndexes() {
    const dbUser = process.env.DB_USER || process.env.DB_USERNAME;
    const dbPass = process.env.DB_PASS || process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME || process.env.DB_DATABASE;
    if (!dbUser || !dbPass || !dbName) {
        console.error('❌ Variáveis DB_USER, DB_PASS e DB_NAME são obrigatórias.');
        process.exit(1);
    }

    const pgConfig = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: dbUser,
        password: dbPass,
        database: dbName,
    };

    const pg = new Client(pgConfig);
    await pg.connect();
    console.log(`[OK] Conectado ao PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);

    let okCount = 0;
    let skipCount = 0;

    try {
        for (const ddl of SCHEMA_PATCHES) {
            try {
                await pg.query(ddl);
                console.log(`[SCHEMA OK] ${ddl.slice(0, 90)}...`);
            } catch (err) {
                console.warn(`[SCHEMA SKIP] ${err.message}`);
            }
        }

        for (const sql of INDEX_STATEMENTS) {
            try {
                await pg.query(sql);
                okCount += 1;
                console.log(`[INDEX OK] ${sql}`);
            } catch (err) {
                skipCount += 1;
                console.warn(`[INDEX SKIP] ${err.message}`);
            }
        }

        await pg.query('ANALYZE');
        console.log(`\n[SUCESSO] ${okCount}/${INDEX_STATEMENTS.length} indices verificados/criados (${skipCount} tabelas opcionais ausentes) + ANALYZE concluido!`);
    } finally {
        await pg.end();
    }
}

applyIndexes();
