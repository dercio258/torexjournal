import { MigrationInterface, QueryRunner } from 'typeorm';

export class AiDailyCreditsAndPlans1772700000000 implements MigrationInterface {
    name = 'AiDailyCreditsAndPlans1772700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "subscription_plan_configs" ADD COLUMN IF NOT EXISTS "aiDailyCredits" integer`
        );

        await queryRunner.query(`
            UPDATE "subscription_plan_configs"
            SET "aiDailyCredits" = CASE
                WHEN UPPER("tier") = 'BASIC' THEN 100
                WHEN UPPER("tier") = 'PRO' THEN 2000
                WHEN UPPER("tier") = 'PREMIUM' THEN 20000
                ELSE COALESCE("aiDailyCredits", 100)
            END
            WHERE "aiDailyCredits" IS NULL OR "aiDailyCredits" <= 0
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ai_user_credits" (
                "user_id" character varying NOT NULL,
                "plan_tier" character varying(30) NOT NULL DEFAULT 'FREE',
                "daily_limit" integer NOT NULL DEFAULT 0,
                "credits_remaining" integer NOT NULL DEFAULT 0,
                "credits_used_today" integer NOT NULL DEFAULT 0,
                "total_credits_used" integer NOT NULL DEFAULT 0,
                "last_reset_date" character varying(10) NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ai_user_credits" PRIMARY KEY ("user_id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_ai_user_credits_reset_date"
            ON "ai_user_credits" ("last_reset_date")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ai_user_credits"`);
        await queryRunner.query(
            `ALTER TABLE "subscription_plan_configs" DROP COLUMN IF EXISTS "aiDailyCredits"`
        );
    }
}
