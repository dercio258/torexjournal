import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const BACKTEST_NORMALIZED_DDL_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "backtest_strategies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "client_strategy_id" character varying(120),
        "name" character varying(180) NOT NULL,
        "trading_method" character varying(160) NOT NULL DEFAULT 'Smart Money Concepts (SMC / ICT)',
        "description" text,
        "session_tag" character varying(120) NOT NULL DEFAULT 'London & NY',
        "status" character varying(32) NOT NULL DEFAULT 'ACTIVE',
        "starting_capital" double precision NOT NULL DEFAULT 100000,
        "currency" character varying(16) NOT NULL DEFAULT 'USD',
        "risk_mode" character varying(32) NOT NULL DEFAULT 'FIXED_RISK',
        "risk_per_trade" double precision NOT NULL DEFAULT 1.0,
        "default_timeframe" character varying(16) NOT NULL DEFAULT '5m',
        "rr_target" double precision NOT NULL DEFAULT 2.0,
        "primary_symbol" character varying(32) NOT NULL DEFAULT 'XAUUSD',
        "symbols" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "journal_config" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backtest_strategies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_backtest_strategies_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "backtest_session_blobs" (
        "session_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "revision" integer NOT NULL DEFAULT 0,
        "orders" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "drawings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "drawn_items" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "drawing_styles_by_id" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "overlay_geometries" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "session_screenshots" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "journal_images" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "quant_metrics" jsonb,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backtest_session_blobs" PRIMARY KEY ("session_id"),
        CONSTRAINT "FK_backtest_session_blobs_session" FOREIGN KEY ("session_id") REFERENCES "backtest_sessions"("id") ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "backtest_hypotheses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "account_id" uuid,
        "name" character varying(200) NOT NULL,
        "mode" character varying(48) NOT NULL DEFAULT 'ACCOUNT_HISTORY',
        "strategy" character varying(160) NOT NULL DEFAULT 'Hipótese sobre o histórico',
        "symbol" character varying(32) NOT NULL DEFAULT 'ALL',
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "results" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backtest_hypotheses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_backtest_hypotheses_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_backtest_hypotheses_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "system_error_logs" (
        "id" uuid NOT NULL,
        "error_ref" character varying(64) NOT NULL,
        "domain" character varying(24) NOT NULL DEFAULT 'SYS',
        "severity" character varying(16) NOT NULL DEFAULT 'error',
        "status_code" integer,
        "method" character varying(12),
        "path" character varying(255),
        "user_id" character varying(64),
        "exception_name" character varying(120),
        "error_code" character varying(64),
        "technical_message" text NOT NULL,
        "public_message" text,
        "was_sanitized" boolean NOT NULL DEFAULT true,
        "stack_preview" text,
        "correlation_id" character varying(64),
        "status" character varying(16) NOT NULL DEFAULT 'OPEN',
        "resolved_at" TIMESTAMP,
        "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_system_error_logs" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" uuid NOT NULL,
        "admin_email" character varying(160) NOT NULL,
        "action" character varying(80) NOT NULL,
        "target_type" character varying(64),
        "target_id" character varying(120),
        "ip" character varying(64),
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "prev_hash" character varying(64) NOT NULL,
        "entry_hash" character varying(64) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_audit_logs" PRIMARY KEY ("id")
    )`,
];

export const BACKTEST_NORMALIZED_INDEX_STATEMENTS: string[] = [
    `CREATE INDEX IF NOT EXISTS "IDX_system_error_logs_created" ON "system_error_logs" ("created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_system_error_logs_ref" ON "system_error_logs" ("error_ref")`,
    `CREATE INDEX IF NOT EXISTS "IDX_system_error_logs_status_sev" ON "system_error_logs" ("status", "severity", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_system_error_logs_domain" ON "system_error_logs" ("domain", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_created" ON "admin_audit_logs" ("created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_action" ON "admin_audit_logs" ("action", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_strategies_user_updated" ON "backtest_strategies" ("user_id", "updated_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_strategies_user_client_id" ON "backtest_strategies" ("user_id", "client_strategy_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_session_blobs_user" ON "backtest_session_blobs" ("user_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_hypotheses_user_updated" ON "backtest_hypotheses" ("user_id", "updated_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_hypotheses_user_account_updated" ON "backtest_hypotheses" ("user_id", "account_id", "updated_at" DESC)`,
];

export const BACKTEST_NORMALIZED_BACKFILL_STATEMENTS: string[] = [
    `INSERT INTO "backtest_strategies" (
        "id", "user_id", "client_strategy_id", "name", "trading_method", "description",
        "session_tag", "status", "starting_capital", "currency", "risk_mode", "risk_per_trade",
        "default_timeframe", "rr_target", "primary_symbol", "symbols", "rules", "journal_config",
        "created_at", "updated_at"
    )
    SELECT
        bs."id",
        bs."user_id",
        COALESCE(bs."client_session_id", NULLIF(bs."config"->>'clientStrategyId', ''), bs."id"::text),
        LEFT(COALESCE(NULLIF(bs."name", ''), NULLIF(bs."config"->>'name', ''), 'Nova Estratégia'), 180),
        LEFT(COALESCE(NULLIF(bs."config"->>'tradingMethod', ''), 'Smart Money Concepts (SMC / ICT)'), 160),
        COALESCE(bs."config"->>'description', bs."notes", ''),
        LEFT(COALESCE(NULLIF(bs."config"->>'sessionTag', ''), 'London & NY'), 120),
        CASE WHEN bs."config"->>'status' = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'ACTIVE' END,
        CASE WHEN (bs."config"->>'startingCapital') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (bs."config"->>'startingCapital')::double precision ELSE 100000 END,
        LEFT(COALESCE(NULLIF(bs."config"->>'currency', ''), 'USD'), 16),
        LEFT(COALESCE(NULLIF(bs."config"->>'riskMode', ''), 'FIXED_RISK'), 32),
        CASE WHEN (bs."config"->>'riskPerTrade') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (bs."config"->>'riskPerTrade')::double precision ELSE 1.0 END,
        LEFT(COALESCE(NULLIF(bs."config"->>'defaultTimeframe', ''), '5m'), 16),
        CASE WHEN (bs."config"->>'rrTarget') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (bs."config"->>'rrTarget')::double precision ELSE 2.0 END,
        LEFT(UPPER(COALESCE(NULLIF(bs."config"->>'primarySymbol', ''), NULLIF(bs."symbol", ''), 'XAUUSD')), 32),
        COALESCE(bs."config"->'symbols', '[]'::jsonb),
        COALESCE(bs."config"->'rules', '[]'::jsonb),
        jsonb_strip_nulls(jsonb_build_object(
            'journalNotes', bs."config"->'journalNotes',
            'journalTitle', bs."config"->'journalTitle',
            'journalMarketBias', bs."config"->'journalMarketBias',
            'journalPsychCheck', bs."config"->'journalPsychCheck',
            'journalImages', bs."config"->'journalImages'
        )),
        bs."created_at",
        bs."updated_at"
    FROM "backtest_sessions" bs
    WHERE bs."mode" = 'STRATEGY_DEFINITION'
    ON CONFLICT ("id") DO NOTHING`,
    `INSERT INTO "backtest_session_blobs" (
        "session_id", "user_id", "revision", "orders", "drawings", "drawn_items",
        "drawing_styles_by_id", "overlay_geometries", "session_screenshots",
        "journal_images", "quant_metrics", "updated_at"
    )
    SELECT
        bs."id",
        bs."user_id",
        CASE WHEN (bs."config"->>'revision') ~ '^[0-9]+$' THEN (bs."config"->>'revision')::integer ELSE 0 END,
        COALESCE(bs."config"->'orders', '[]'::jsonb),
        COALESCE(bs."config"->'drawings', '[]'::jsonb),
        COALESCE(bs."config"->'drawnItems', '[]'::jsonb),
        COALESCE(bs."config"->'drawingStylesById', '{}'::jsonb),
        COALESCE(bs."config"->'overlayGeometries', '{}'::jsonb),
        COALESCE(bs."config"->'sessionScreenshots', '[]'::jsonb),
        COALESCE(bs."config"->'journalImages', '[]'::jsonb),
        bs."results"->'quantMetrics',
        bs."updated_at"
    FROM "backtest_sessions" bs
    WHERE bs."mode" = 'REPLAY_SESSION'
    ON CONFLICT ("session_id") DO NOTHING`,
    `INSERT INTO "backtest_hypotheses" (
        "id", "user_id", "account_id", "name", "mode", "strategy", "symbol",
        "config", "results", "notes", "created_at", "updated_at"
    )
    SELECT
        bs."id",
        bs."user_id",
        bs."account_id",
        LEFT(COALESCE(NULLIF(bs."name", ''), 'Hipótese'), 200),
        LEFT(COALESCE(NULLIF(bs."mode", ''), 'ACCOUNT_HISTORY'), 48),
        LEFT(COALESCE(NULLIF(bs."strategy", ''), 'Hipótese sobre o histórico'), 160),
        LEFT(COALESCE(NULLIF(bs."symbol", ''), 'ALL'), 32),
        COALESCE(bs."config", '{}'::jsonb),
        COALESCE(bs."results", '{}'::jsonb),
        bs."notes",
        bs."created_at",
        bs."updated_at"
    FROM "backtest_sessions" bs
    WHERE bs."mode" IN ('ACCOUNT_HISTORY', 'STRATEGY_SIM')
    ON CONFLICT ("id") DO NOTHING`,
];

export const SCHEMA_PATCH_STATEMENTS: string[] = [
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_locale" character varying(8) NOT NULL DEFAULT 'pt'`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" character varying(64)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attribution_data" jsonb`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "visitor_id" character varying(120)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisition_source" character varying(160)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisition_medium" character varying(160)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisition_campaign" character varying(200)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisition_content" character varying(200)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisition_term" character varying(200)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "landing_path" character varying(512)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referrer" character varying(1024)`,
    `ALTER TABLE "backtest_sessions" ADD COLUMN IF NOT EXISTS "client_session_id" character varying(120)`,
    `UPDATE "backtest_sessions" SET "client_session_id" = COALESCE(config->>'clientSessionId', config->>'clientStrategyId') WHERE "client_session_id" IS NULL AND (config ? 'clientSessionId' OR config ? 'clientStrategyId')`,
    `CREATE TABLE IF NOT EXISTS "tracking_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_name" character varying(120) NOT NULL,
        "event_type" character varying(32) NOT NULL,
        "visitor_id" character varying(120) NOT NULL,
        "session_id" character varying(120),
        "user_id" uuid,
        "page_path" character varying(512),
        "page_title" character varying(256),
        "element_id" character varying(120),
        "element_label" character varying(256),
        "cta_tag" character varying(120),
        "intent" character varying(120),
        "target_url" character varying(1024),
        "referrer" character varying(1024),
        "utm_source" character varying(160),
        "utm_medium" character varying(160),
        "utm_campaign" character varying(200),
        "utm_content" character varying(200),
        "utm_term" character varying(200),
        "utm_id" character varying(160),
        "click_id" character varying(200),
        "locale" character varying(16),
        "device_type" character varying(32),
        "ip_hash" character varying(64),
        "user_agent" character varying(512),
        "revenue" double precision,
        "currency" character varying(16),
        "metadata" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tracking_events" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_tracking_events_type_created" ON "tracking_events" ("event_type", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_tracking_events_visitor_created" ON "tracking_events" ("visitor_id", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_tracking_events_user_created" ON "tracking_events" ("user_id", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_tracking_events_utm_source_created" ON "tracking_events" ("utm_source", "created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_tracking_events_cta_tag_created" ON "tracking_events" ("cta_tag", "created_at")`,
    `CREATE TABLE IF NOT EXISTS "email_tracking_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token" character varying(64) NOT NULL,
        "recipient_email" character varying(320) NOT NULL,
        "user_id" uuid,
        "template" character varying(120) NOT NULL,
        "subject" character varying(320),
        "broadcast_id" character varying(120),
        "utm_campaign" character varying(200),
        "utm_medium" character varying(120),
        "sent_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "opened_at" TIMESTAMPTZ,
        "open_count" integer NOT NULL DEFAULT 0,
        "first_clicked_at" TIMESTAMPTZ,
        "click_count" integer NOT NULL DEFAULT 0,
        "last_clicked_url" character varying(1024),
        "last_cta_tag" character varying(160),
        "metadata" jsonb,
        CONSTRAINT "PK_email_tracking_logs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_email_tracking_logs_token" UNIQUE ("token")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_email_tracking_logs_template_sent" ON "email_tracking_logs" ("template", "sent_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_email_tracking_logs_broadcast" ON "email_tracking_logs" ("broadcast_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_email_tracking_logs_recipient" ON "email_tracking_logs" ("recipient_email")`,
    `CREATE TABLE IF NOT EXISTS "tracking_configs" (
        "key" character varying(64) NOT NULL DEFAULT 'default',
        "meta_pixel_id" character varying(120),
        "meta_capi_access_token" character varying(512),
        "ga4_measurement_id" character varying(120),
        "gtm_container_id" character varying(120),
        "tiktok_pixel_id" character varying(120),
        "utmify_pixel_id" character varying(120),
        "enable_first_party_tracking" boolean NOT NULL DEFAULT true,
        "enable_email_tracking" boolean NOT NULL DEFAULT true,
        "enable_cta_auto_tracking" boolean NOT NULL DEFAULT true,
        "custom_head_script" text,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tracking_configs" PRIMARY KEY ("key")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_users_acquisition_source" ON "users" ("acquisition_source")`,
    `CREATE INDEX IF NOT EXISTS "IDX_users_visitor_id" ON "users" ("visitor_id")`,
    `ALTER TABLE "economic_events" ADD COLUMN IF NOT EXISTS "external_id" character varying(64)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_action_type" character varying(64)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_action_label" character varying(180)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_action_path" character varying(255)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" character varying(32)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_user_id" character varying(64)`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_credits_usd" numeric(10,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_tier_boost" boolean NOT NULL DEFAULT false`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_referral_code" ON "users" ("referral_code") WHERE "referral_code" IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "endpoint" character varying(1024) NOT NULL,
        "p256dh" character varying(256) NOT NULL,
        "auth" character varying(128) NOT NULL,
        "user_agent" character varying(512),
        "device_label" character varying(120),
        "is_standalone_app" boolean NOT NULL DEFAULT false,
        "locale" character varying(16) NOT NULL DEFAULT 'pt',
        "is_active" boolean NOT NULL DEFAULT true,
        "last_sent_at" TIMESTAMPTZ,
        "failure_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_subscriptions_endpoint" UNIQUE ("endpoint")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_push_subscriptions_user_active" ON "push_subscriptions" ("user_id", "is_active")`,
    `CREATE TABLE IF NOT EXISTS "push_delivery_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" character varying(64) NOT NULL,
        "click_token" character varying(80) NOT NULL,
        "category" character varying(64) NOT NULL,
        "title" character varying(120) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'SENT',
        "sent_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "interacted_at" TIMESTAMPTZ,
        "moderation_mode" character varying(32) NOT NULL DEFAULT 'ENGAGED',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_delivery_logs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_delivery_click_token" UNIQUE ("click_token")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_push_delivery_user_sent" ON "push_delivery_logs" ("user_id", "sent_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_push_delivery_category_sent" ON "push_delivery_logs" ("category", "sent_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_push_delivery_status_sent" ON "push_delivery_logs" ("status", "sent_at")`,
    `CREATE TABLE IF NOT EXISTS "referrals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "referrer_user_id" character varying(64) NOT NULL,
        "referred_user_id" character varying(64) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'REGISTERED',
        "reward_credits_usd" numeric(10,2) NOT NULL DEFAULT 0,
        "tier_boost_awarded" boolean NOT NULL DEFAULT false,
        "verified_at" TIMESTAMPTZ,
        "paid_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referrals_referred_user" UNIQUE ("referred_user_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_referrals_referrer_status" ON "referrals" ("referrer_user_id", "status")`,
    `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" jsonb`,
    `CREATE TABLE IF NOT EXISTS "crypto_payment_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "payment_reference" character varying(80) NOT NULL,
        "provider_payment_id" character varying(100) NOT NULL,
        "tier" character varying(50) NOT NULL,
        "cycle" character varying(30) NOT NULL,
        "fiat_amount_usd" numeric(10,2) NOT NULL,
        "fiat_currency" character varying(10) NOT NULL DEFAULT 'USD',
        "crypto_currency" character varying(32) NOT NULL,
        "pay_currency_code" character varying(32) NOT NULL,
        "display_name" character varying(100) NOT NULL,
        "network" character varying(100) NOT NULL,
        "icon_url" character varying(320),
        "wallet_address" character varying(255) NOT NULL,
        "payin_extra_id" character varying(120),
        "crypto_amount" character varying(64) NOT NULL,
        "actually_paid" character varying(64),
        "qr_code_data_url" text NOT NULL,
        "provider_status" character varying(40) NOT NULL DEFAULT 'waiting',
        "expires_at" TIMESTAMPTZ,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crypto_payment_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_crypto_payment_sessions_reference" UNIQUE ("payment_reference"),
        CONSTRAINT "UQ_crypto_payment_sessions_provider_id" UNIQUE ("provider_payment_id")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_crypto_payment_sessions_user_status_created" ON "crypto_payment_sessions" ("user_id", "provider_status", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_crypto_payment_sessions_subscription" ON "crypto_payment_sessions" ("subscription_id")`,
    `CREATE TABLE IF NOT EXISTS "pix_payment_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "subscription_id" uuid NOT NULL,
        "payment_reference" character varying(80) NOT NULL,
        "provider_transaction_id" character varying(120) NOT NULL,
        "tier" character varying(50) NOT NULL,
        "cycle" character varying(30) NOT NULL,
        "amount_usd" numeric(10,2) NOT NULL,
        "usd_to_brl_rate" numeric(10,4) NOT NULL,
        "amount_brl" numeric(10,2) NOT NULL,
        "rate_source" character varying(32) NOT NULL DEFAULT 'live_market',
        "payer_name" character varying(140) NOT NULL,
        "payer_document_type" character varying(10) NOT NULL,
        "payer_document_masked" character varying(32) NOT NULL,
        "emv_code" text NOT NULL,
        "qr_code_data_url" text NOT NULL,
        "provider_status" character varying(40) NOT NULL DEFAULT 'pending',
        "expires_at" TIMESTAMPTZ,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pix_payment_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pix_payment_sessions_reference" UNIQUE ("payment_reference")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_pix_payment_sessions_user_status_created" ON "pix_payment_sessions" ("user_id", "provider_status", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_pix_payment_sessions_subscription" ON "pix_payment_sessions" ("subscription_id")`,
    `CREATE TABLE IF NOT EXISTS "subscription_renewal_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token" character varying(96) NOT NULL,
        "subscription_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "plan_config_id" uuid NOT NULL,
        "tier" character varying(50) NOT NULL,
        "cycle" character varying(30) NOT NULL,
        "amount_usd" numeric(10,2) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'PENDING',
        "due_date" TIMESTAMPTZ NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "paid_at" TIMESTAMPTZ,
        "paid_subscription_id" uuid,
        "payment_method" character varying(40),
        "payment_reference" character varying(80),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_renewal_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_renewal_invoices_token" UNIQUE ("token")
    )`,
    `CREATE INDEX IF NOT EXISTS "IDX_renewal_invoices_subscription_status" ON "subscription_renewal_invoices" ("subscription_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "IDX_renewal_invoices_user_status" ON "subscription_renewal_invoices" ("user_id", "status")`,
    ...BACKTEST_NORMALIZED_DDL_STATEMENTS,
];

export const COMPOSITE_INDEX_STATEMENTS: string[] = [
    // 1. Core Trading, Positions, Accounts & Deriv
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

    // 2. Users, Subscriptions, Sessions, Security & WhatsApp
    `CREATE INDEX IF NOT EXISTS "IDX_users_refresh_token" ON "users" ("refresh_token")`,
    `CREATE INDEX IF NOT EXISTS "IDX_users_created_at" ON "users" ("createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_user_status_end" ON "subscriptions" ("userId", "status", "currentPeriodEnd" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_status_end" ON "subscriptions" ("status", "currentPeriodEnd")`,
    `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_payment_ref" ON "subscriptions" ("paymentReference")`,
    `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_debito_tx" ON "subscriptions" ("debitoTransactionId")`,
    `CREATE INDEX IF NOT EXISTS "IDX_sessions_user_active_expires" ON "sessions" ("userId", "isActive", "expiresAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_timestamp" ON "audit_logs" ("user_id", "timestamp" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_whatsapp_links_user_active" ON "whatsapp_links" ("user_id", "is_active")`,

    // 3. Journal, Notes, Notifications, Alerts & Imports
    `CREATE INDEX IF NOT EXISTS "IDX_daily_notes_user_date" ON "daily_notes" ("user_id", "date" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_trade_notes_user_trade" ON "trade_notes" ("user_id", "trade_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_general_notes_user_template_pinned" ON "general_notes" ("user_id", "is_template", "pinned")`,
    `CREATE INDEX IF NOT EXISTS "IDX_mental_logs_account_date" ON "mental_logs" ("account_id", "date" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_technical_journals_account_date" ON "technical_journals" ("account_id", "date" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_notifications_account_read_created" ON "notifications" ("account_id", "is_read", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_alerts_user_resolved_created" ON "alerts" ("user_id", "resolved", "created_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_import_logs_user_created" ON "import_logs" ("userId", "createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_import_logs_account_created" ON "import_logs" ("account_id", "createdAt" DESC)`,

    // 4. Backtesting, Torex AI & Network/Academy
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_updated" ON "backtest_sessions" ("user_id", "updated_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_client_id" ON "backtest_sessions" ("user_id", "client_session_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_backtest_sessions_user_mode_updated" ON "backtest_sessions" ("user_id", "mode", "updated_at" DESC)`,
    ...BACKTEST_NORMALIZED_INDEX_STATEMENTS,
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
    `CREATE INDEX IF NOT EXISTS "IDX_economic_events_external_id" ON "economic_events" ("external_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_economic_events_date_impact" ON "economic_events" ("event_date" ASC, "impact")`,
    `CREATE INDEX IF NOT EXISTS "IDX_users_last_login_at" ON "users" ("last_login_at" DESC)`,
    `CREATE INDEX IF NOT EXISTS "IDX_users_last_active_at" ON "users" ("last_active_at" DESC)`,
];

const IDEMPOTENT_BACKFILL_STATEMENTS: string[] = [
    `UPDATE "users" u
     SET "email_verified_at" = COALESCE(u."email_verified_at", u."createdAt")
     WHERE u."email_verified_at" IS NULL
       AND (
         u."google_id" IS NOT NULL
         OR u."github_id" IS NOT NULL
         OR u."is_two_factor_confirmed" = true
         OR EXISTS (SELECT 1 FROM "sessions" s WHERE s."userId" = u."id")
         OR EXISTS (
             SELECT 1 FROM "audit_logs" a
             WHERE a."user_id" = u."id" AND a."action" IN ('USER_REGISTERED', 'LOGIN_SUCCESS')
         )
       )`,
    `UPDATE "users" u
     SET "last_login_at" = COALESCE(
         u."last_login_at",
         (SELECT MAX(s."createdAt") FROM "sessions" s WHERE s."userId" = u."id"),
         (SELECT MAX(a."timestamp") FROM "audit_logs" a WHERE a."user_id" = u."id" AND a."action" = 'LOGIN_SUCCESS')
     )
     WHERE u."last_login_at" IS NULL`,
    `UPDATE "users" u
     SET "last_active_at" = te.created_at,
         "last_action_type" = COALESCE(u."last_action_type", te.event_type),
         "last_action_label" = COALESCE(u."last_action_label", NULLIF(te.element_label, ''), NULLIF(te.cta_tag, ''), NULLIF(te.page_title, ''), te.event_name),
         "last_action_path" = COALESCE(u."last_action_path", te.page_path)
     FROM (
         SELECT DISTINCT ON ("user_id")
             "user_id",
             "event_name",
             "event_type",
             "element_label",
             "cta_tag",
             "page_title",
             "page_path",
             "created_at"
         FROM "tracking_events"
         WHERE "user_id" IS NOT NULL
         ORDER BY "user_id", "created_at" DESC
     ) te
     WHERE u."id" = te."user_id"
       AND u."last_active_at" IS NULL`,
    `UPDATE "users"
     SET "last_active_at" = "last_login_at",
         "last_action_type" = COALESCE("last_action_type", 'login'),
         "last_action_label" = COALESCE("last_action_label", 'Último login registrado')
     WHERE "last_active_at" IS NULL
       AND "last_login_at" IS NOT NULL`,
    ...BACKTEST_NORMALIZED_BACKFILL_STATEMENTS,
];

@Injectable()
export class DatabaseIndexBootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(DatabaseIndexBootstrapService.name);

    constructor(private readonly dataSource: DataSource) {}

    onApplicationBootstrap() {
        // Executa de forma não bloqueante após o boot HTTP para garantir colunas e índices compostos
        void this.ensureIndexes();
    }

    private async ensureIndexes(): Promise<void> {
        if (!this.dataSource?.isInitialized) return;

        for (const ddl of SCHEMA_PATCH_STATEMENTS) {
            try {
                await this.dataSource.query(ddl);
            } catch {
                // Safe ignore if table not initialized yet
            }
        }

        let applied = 0;
        for (const sql of COMPOSITE_INDEX_STATEMENTS) {
            try {
                await this.dataSource.query(sql);
                applied += 1;
            } catch {
                // Silencioso caso uma tabela opcional ainda não exista no ambiente dedicado
            }
        }
        this.logger.log(`Verified ${applied}/${COMPOSITE_INDEX_STATEMENTS.length} composite PostgreSQL performance indexes.`);

        for (const sql of IDEMPOTENT_BACKFILL_STATEMENTS) {
            try {
                await this.dataSource.query(sql);
            } catch {
                // Safe ignore if optional tables aren't seeded yet
            }
        }
    }
}
