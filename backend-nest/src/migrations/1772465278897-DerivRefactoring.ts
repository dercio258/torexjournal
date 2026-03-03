import { MigrationInterface, QueryRunner } from "typeorm";

export class DerivRefactoring1772465278897 implements MigrationInterface {
    name = 'DerivRefactoring1772465278897'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trades" ADD "entrySpot" numeric(10,5)`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "exitSpot" numeric(10,5)`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "buyPrice" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "sellPrice" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "payout" numeric(10,2)`);
        await queryRunner.query(`CREATE TYPE "public"."trades_dataquality_enum" AS ENUM('ok', 'partial', 'broken')`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "dataQuality" "public"."trades_dataquality_enum" NOT NULL DEFAULT 'ok'`);
        await queryRunner.query(`ALTER TABLE "trades" ADD "syntheticTxid" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "trades" DROP CONSTRAINT "UQ_b24c1d2a56ea3e05f7436a99bf5"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ce2d23b5b3e4ee38f63ea16ff6" ON "trades" ("account_id", "contractId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_ce2d23b5b3e4ee38f63ea16ff6"`);
        await queryRunner.query(`ALTER TABLE "trades" ADD CONSTRAINT "UQ_b24c1d2a56ea3e05f7436a99bf5" UNIQUE ("contractId")`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "syntheticTxid"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "dataQuality"`);
        await queryRunner.query(`DROP TYPE "public"."trades_dataquality_enum"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "payout"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "sellPrice"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "buyPrice"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "exitSpot"`);
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "entrySpot"`);
    }

}
