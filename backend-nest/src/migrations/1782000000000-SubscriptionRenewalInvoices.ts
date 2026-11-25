import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionRenewalInvoices1782000000000 implements MigrationInterface {
    name = 'SubscriptionRenewalInvoices1782000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "subscription_renewal_invoices" (
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
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_renewal_invoices_subscription_status" ON "subscription_renewal_invoices" ("subscription_id", "status")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_renewal_invoices_user_status" ON "subscription_renewal_invoices" ("user_id", "status")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "subscription_renewal_invoices"`);
    }
}
