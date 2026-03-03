import { MigrationInterface, QueryRunner } from "typeorm";

export class InitTimescale1700000000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Enable TimescaleDB Extension
        // Note: Needs superuser privileges. If this fails, user must run it manually.
        try {
            await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`);
        } catch (e) {
            console.warn("Could not enable TimescaleDB extension. Ensure DB user has permissions.", e.message);
        }

        // 2. Converto to Hypertable
        // We assume 'market_ticks' table is created by TypeORM synchronization before this runs (or handled by logic)
        // If TypeORM logic creates the table first, we just convert it.

        // Check if table exists
        const tableExists = await queryRunner.hasTable('market_ticks');
        if (tableExists) {
            try {
                await queryRunner.query(`SELECT create_hypertable('market_ticks', 'timestamp', if_not_exists => TRUE);`);
                console.log("✅ 'market_ticks' converted to Hypertable.");
            } catch (e) {
                console.warn("Failed to create hypertable:", e.message);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Usually we don't revert hypertable conversion easily without dropping
    }

}
