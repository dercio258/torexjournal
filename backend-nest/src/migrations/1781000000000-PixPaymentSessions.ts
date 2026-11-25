import { MigrationInterface, QueryRunner } from 'typeorm';

export class PixPaymentSessions1781000000000 implements MigrationInterface {
    name = 'PixPaymentSessions1781000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "pix_payment_sessions" (
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
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_pix_payment_sessions_user_status_created" ON "pix_payment_sessions" ("user_id", "provider_status", "created_at" DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_pix_payment_sessions_subscription" ON "pix_payment_sessions" ("subscription_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "pix_payment_sessions"`);
    }
}
