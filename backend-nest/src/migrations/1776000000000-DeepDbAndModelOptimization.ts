import { MigrationInterface, QueryRunner } from 'typeorm';
import {
    COMPOSITE_INDEX_STATEMENTS,
    SCHEMA_PATCH_STATEMENTS,
} from '../common/database/database-index-bootstrap.service';

export class DeepDbAndModelOptimization1776000000000 implements MigrationInterface {
    name = 'DeepDbAndModelOptimization1776000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const ddl of SCHEMA_PATCH_STATEMENTS) {
            await queryRunner.query(`
                DO $$
                BEGIN
                    ${ddl};
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END $$;
            `);
        }

        for (const idxSql of COMPOSITE_INDEX_STATEMENTS) {
            await queryRunner.query(`
                DO $$
                BEGIN
                    ${idxSql};
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END $$;
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backtest_sessions_user_client_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backtest_sessions_user_mode_updated"`);
        await queryRunner.query(`ALTER TABLE IF EXISTS "backtest_sessions" DROP COLUMN IF EXISTS "client_session_id"`);
    }
}
