const { Client } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function runCleanup() {
    console.log("🚀 Starting PostgreSQL cleanup script...");
    try {
        await client.connect();
        console.log("Connected to database successfully.");

        // 1. Check tables existence
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = tablesRes.rows.map(r => r.table_name);

        const hasLegacyPositions = tables.includes('Positions');
        const hasNewPositions = tables.includes('positions');
        const hasMarketTicks = tables.includes('market_ticks');

        // 2. Migrate legacy positions data if needed
        if (hasLegacyPositions && hasNewPositions) {
            console.log("📋 Found legacy 'Positions' and new 'positions' tables. Checking data migration...");
            const legacyCountRes = await client.query('SELECT COUNT(*) as count FROM "Positions"');
            const legacyCount = parseInt(legacyCountRes.rows[0].count);

            if (legacyCount > 0) {
                console.log(`Migrating ${legacyCount} rows from legacy 'Positions' to 'positions'...`);
                
                // Get all rows from legacy "Positions"
                const legacyRowsRes = await client.query('SELECT * FROM "Positions"');
                const legacyRows = legacyRowsRes.rows;

                let migratedCount = 0;
                for (const row of legacyRows) {
                    // Check if already exists in new table
                    const existsRes = await client.query(
                        'SELECT 1 FROM "positions" WHERE id = $1 OR (ticket = $2 AND account_id = $3)', 
                        [row.id, String(row.ticket), row.account_id]
                    );

                    if (existsRes.rows.length === 0) {
                        await client.query(`
                            INSERT INTO "positions" (
                                id, account_id, ticket, symbol, type, volume, 
                                open_price, current_price, profit, sl, tp, open_time, 
                                "createdAt", "updatedAt"
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                        `, [
                            row.id,
                            row.account_id,
                            String(row.ticket),
                            row.symbol,
                            row.type,
                            row.volume,
                            row.open_price,
                            row.current_price,
                            row.profit,
                            row.sl,
                            row.tp,
                            row.open_time,
                            row.createdAt || new Date(),
                            row.updatedAt || new Date()
                        ]);
                        migratedCount++;
                    }
                }
                console.log(`✅ Migrated ${migratedCount} position records successfully.`);
            } else {
                console.log("Legacy 'Positions' table is empty. No data to migrate.");
            }
        }

        // 3. Drop legacy "Positions" table
        if (hasLegacyPositions) {
            console.log("Dropping legacy 'Positions' table...");
            await client.query('DROP TABLE IF EXISTS "Positions" CASCADE;');
            console.log("✅ Legacy 'Positions' table dropped.");
        }

        // 4. Drop discontinued market_ticks table
        if (hasMarketTicks) {
            console.log("Dropping discontinued 'market_ticks' table (migrated to ClickHouse)...");
            await client.query('DROP TABLE IF EXISTS market_ticks CASCADE;');
            console.log("✅ 'market_ticks' table dropped.");
        }

        console.log("\n------------------------------------------------");
        console.log("🎉 PostgreSQL database cleanup completed successfully!");
        console.log("------------------------------------------------");

    } catch (err) {
        console.error("❌ Cleanup failed with error:", err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runCleanup();
