import { Client } from 'pg';
import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

async function run() {
    const email = 'derciomatsope9@gmail.com';

    // 1. PostgreSQL Connection
    const pgClient = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'cossa_trading_user',
        password: process.env.DB_PASS || 'C0ssa@2026_db!',
        database: process.env.DB_NAME || 'cossa_trading',
    });

    await pgClient.connect();
    
    // Find User
    const userRes = await pgClient.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
        console.log(`User ${email} not found.`);
        await pgClient.end();
        return;
    }
    const userId = userRes.rows[0].id;
    console.log(`Found User ID in PG: ${userId}`);

    // Count user accounts
    const accountsRes = await pgClient.query('SELECT id, name, type FROM accounts WHERE "userId" = $1', [userId]);
    console.log(`User has ${accountsRes.rows.length} accounts in PG:`, accountsRes.rows);

    if (accountsRes.rows.length === 0) {
        console.log('No accounts found for user. Hence, no trades.');
        await pgClient.end();
        return;
    }

    const accountIds = accountsRes.rows.map(a => a.id);

    // Count trades in PG
    const pgTradesRes = await pgClient.query(
        'SELECT count(*), status FROM trades WHERE "accountId" = ANY($1) GROUP BY status',
        [accountIds]
    );
    console.log('PG Trades counts by status:', pgTradesRes.rows);

    // Get 5 sample trades from PG
    const pgSampleRes = await pgClient.query(
        'SELECT id, "accountId", symbol, profit, status, "closeTime" FROM trades WHERE "accountId" = ANY($1) LIMIT 5',
        [accountIds]
    );
    console.log('PG Sample trades:', pgSampleRes.rows);

    await pgClient.end();

    // 2. ClickHouse Connection
    try {
        const chClient = createClient({
            url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USER || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: process.env.CLICKHOUSE_DATABASE || 'default',
        });

        console.log('Connecting to ClickHouse...');
        const chRes = await chClient.query({
            query: 'SELECT count(*), status FROM trades WHERE accountId IN ({accountIds:Array(String)}) GROUP BY status',
            query_params: { accountIds },
            format: 'JSONEachRow'
        });
        const chRows = await chRes.json();
        console.log('ClickHouse Trades counts by status:', chRows);

        const chSample = await chClient.query({
            query: 'SELECT id, accountId, symbol, profit, status, closeTime FROM trades WHERE accountId IN ({accountIds:Array(String)}) LIMIT 5',
            query_params: { accountIds },
            format: 'JSONEachRow'
        });
        const chSampleRows = await chSample.json();
        console.log('ClickHouse Sample trades:', chSampleRows);

    } catch (err) {
        console.error('ClickHouse inspect failed:', err.message);
    }
}

run().catch(console.error);
