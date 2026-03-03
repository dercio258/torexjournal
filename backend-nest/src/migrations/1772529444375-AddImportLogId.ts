import { MigrationInterface, QueryRunner } from "typeorm";

export class AddImportLogId1772529444375 implements MigrationInterface {
    name = 'AddImportLogId1772529444375'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trades" ADD "import_log_id" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trades" DROP COLUMN "import_log_id"`);
    }

}
