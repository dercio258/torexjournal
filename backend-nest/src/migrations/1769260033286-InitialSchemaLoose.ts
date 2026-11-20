import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Non-destructive idempotent baseline reconciliation migration.
 * Replaces the legacy destructive migration that dropped/re-added columns.
 */
export class InitialSchemaLoose1769260033286 implements MigrationInterface {
    name = 'InitialSchemaLoose1769260033286';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "positions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "account_id" uuid NOT NULL,
                "ticket" character varying NOT NULL,
                "symbol" character varying NOT NULL,
                "type" character varying NOT NULL,
                "volume" numeric(18,2) NOT NULL DEFAULT 0,
                "open_price" numeric(18,5) NOT NULL DEFAULT 0,
                "current_price" numeric(18,5),
                "profit" numeric(18,2) NOT NULL DEFAULT 0,
                "sl" numeric(18,5),
                "tp" numeric(18,5),
                "open_time" TIMESTAMP NOT NULL DEFAULT now(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_positions_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "commission" numeric(10,2) NOT NULL DEFAULT '0'`,
        );
        await queryRunner.query(
            `ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "swap" numeric(10,2) NOT NULL DEFAULT '0'`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_accounts_user_mt5" ON "accounts" ("user_id", "mt5_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Non-destructive rollback: never drop columns or data tables.
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_user_mt5"`);
    }
}
