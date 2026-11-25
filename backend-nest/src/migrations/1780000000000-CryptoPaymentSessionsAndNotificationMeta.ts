import { MigrationInterface, QueryRunner } from 'typeorm';

export class CryptoPaymentSessionsAndNotificationMeta1780000000000 implements MigrationInterface {
    name = 'CryptoPaymentSessionsAndNotificationMeta1780000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "crypto_payment_sessions" (
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
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_crypto_payment_sessions_user_status_created" ON "crypto_payment_sessions" ("user_id", "provider_status", "created_at" DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_crypto_payment_sessions_subscription" ON "crypto_payment_sessions" ("subscription_id")`,
        );
        await queryRunner.query(
            `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" jsonb`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "crypto_payment_sessions"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN IF EXISTS "metadata"`);
    }
}
