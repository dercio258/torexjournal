import { MigrationInterface, QueryRunner } from 'typeorm';
import {
    BACKTEST_NORMALIZED_BACKFILL_STATEMENTS,
    BACKTEST_NORMALIZED_DDL_STATEMENTS,
    BACKTEST_NORMALIZED_INDEX_STATEMENTS,
} from '../common/database/database-index-bootstrap.service';

export class NormalizeBacktestTables1778000000000 implements MigrationInterface {
    name = 'NormalizeBacktestTables1778000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const ddl of BACKTEST_NORMALIZED_DDL_STATEMENTS) {
            await queryRunner.query(`
                DO $$
                BEGIN
                    ${ddl};
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END $$;
            `);
        }

        for (const idxSql of BACKTEST_NORMALIZED_INDEX_STATEMENTS) {
            await queryRunner.query(`
                DO $$
                BEGIN
                    ${idxSql};
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END $$;
            `);
        }

        for (const backfillSql of BACKTEST_NORMALIZED_BACKFILL_STATEMENTS) {
            await queryRunner.query(`
                DO $$
                BEGIN
                    ${backfillSql};
                EXCEPTION WHEN undefined_table OR undefined_column THEN
                    NULL;
                END $$;
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "backtest_session_blobs"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "backtest_hypotheses"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "backtest_strategies"`);
    }
}
